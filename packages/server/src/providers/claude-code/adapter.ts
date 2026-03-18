import { Effect, Stream, Queue, Deferred } from "effect";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import prisma from "../../db/prisma.js";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { parseDiff } from "./parse-diff.js";
import type {
  ProviderAdapterShape,
  ProviderCapabilities,
  SessionStartInput,
  SendTurnInput,
  ProviderSession,
  TurnStartResult,
  ApprovalDecision,
  ThreadSnapshot,
} from "../adapter.js";
import type { ProviderEventEnvelope } from "../events.js";
import {
  ThreadId,
  TurnId,
  EventId,
  SessionNotFoundError,
  ProcessError,
} from "../types.js";
import type { AdapterError } from "../types.js";
import { classifyTool } from "./classify-tool.js";
import { getSubagentDefinitions } from "./subagents.js";
import { createAgentHooks } from "./hooks.js";
import { getBlueprint } from "../../cycles/blueprints.js";
import { runAnkiStalenessCheck } from "./anki-staleness.js";
import { createPatchworkMcpServer } from "./custom-tools.js";
import { setupWorkspaceClaudeConfig } from "./workspace-setup.js";

interface PendingRequest {
  requestId: string;
  deferred: Deferred.Deferred<ApprovalDecision, never>;
}

interface SessionState {
  session: ProviderSession & {
    apiKey?: string;
    useSubscription?: boolean;
    githubToken?: string;
    workspacePath?: string;
    userId?: string;
    projectId?: string;
    teamId?: string;
  };
  abortController: AbortController;
  pendingRequests: Map<string, PendingRequest>;
  activeQuery: ReturnType<typeof query> | null;
  /** When true, all tools are auto-approved for this session */
  autoApproveAll: boolean;
  /** File checkpoint UUIDs for rewind support */
  checkpoints: string[];
  /** Current todo items tracked via TodoWrite tool */
  todos: Map<string, { content: string; status: string }>;
}

export class ClaudeCodeAdapter implements ProviderAdapterShape {
  readonly provider = "claudeCode" as const;
  readonly capabilities: ProviderCapabilities = {
    sessionModelSwitch: "restart-session",
    supportsApprovals: true,
    supportsPlanMode: true,
    supportsResume: true,
    supportsSubagents: true,
    supportsFileCheckpointing: true,
    supportsCustomTools: true,
    supportsTodoTracking: true,
  };

  private sessions = new Map<string, SessionState>();
  private eventQueue: Queue.Queue<ProviderEventEnvelope>;

  hasSession(threadId: ThreadId): boolean {
    return this.sessions.has(threadId as string);
  }

  constructor() {
    this.eventQueue = Effect.runSync(Queue.unbounded<ProviderEventEnvelope>());
  }

  private makeEnvelope(
    type: ProviderEventEnvelope["type"],
    threadId: ThreadId,
    payload: any,
    turnId?: TurnId,
    raw?: unknown
  ): ProviderEventEnvelope {
    return {
      eventId: EventId(randomUUID()),
      type,
      provider: "claudeCode",
      threadId,
      turnId,
      payload,
      createdAt: new Date(),
      raw,
    };
  }

  private async enqueue(envelope: ProviderEventEnvelope): Promise<void> {
    await Effect.runPromise(Queue.offer(this.eventQueue, envelope));
  }

  get streamEvents(): Stream.Stream<ProviderEventEnvelope, AdapterError> {
    return Stream.fromQueue(this.eventQueue);
  }

  startSession(input: SessionStartInput): Effect.Effect<ProviderSession, AdapterError> {
    const self = this;
    return Effect.gen(function* () {
      const sessionId = randomUUID();

      const session: SessionState["session"] = {
        threadId: input.threadId,
        provider: "claudeCode",
        sessionId,
        model: input.model ?? "claude-opus-4-6",
        runtimeMode: input.runtimeMode,
        resumeCursor: input.resumeCursor,
        apiKey: input.apiKey,
        useSubscription: input.useSubscription,
        githubToken: input.githubToken,
        workspacePath: input.workspacePath,
        userId: input.userId,
        projectId: input.projectId,
      };

      const state: SessionState = {
        session,
        abortController: new AbortController(),
        pendingRequests: new Map(),
        activeQuery: null,
        autoApproveAll: false,
        checkpoints: [],
        todos: new Map(),
      };

      self.sessions.set(input.threadId as string, state);

      // Look up teamId for the thread so SendMessage can route inter-agent messages
      yield* Effect.tryPromise({
        try: async () => {
          const threadRecord = await prisma.thread.findUnique({
            where: { id: input.threadId as string },
            select: { teamId: true },
          });
          if (threadRecord?.teamId) {
            state.session.teamId = threadRecord.teamId;
          }
        },
        catch: () =>
          new ProcessError({
            threadId: input.threadId,
            message: "Failed to look up teamId",
            recoverable: false,
          }),
      });

      yield* Effect.tryPromise({
        try: () =>
          self.enqueue(
            self.makeEnvelope("session.started", input.threadId, {
              sessionId,
              model: session.model,
              runtimeMode: input.runtimeMode,
            })
          ),
        catch: (e) =>
          new ProcessError({
            threadId: input.threadId,
            message: `Failed to emit session.started: ${e}`,
            recoverable: false,
          }),
      });

      return session;
    });
  }

  stopSession(threadId: ThreadId): Effect.Effect<void, AdapterError> {
    const self = this;
    return Effect.gen(function* () {
      const state = self.sessions.get(threadId as string);
      if (!state) {
        return yield* Effect.fail(new SessionNotFoundError({ threadId }));
      }

      // Interrupt and abort the active query
      if (state.activeQuery) {
        state.activeQuery.interrupt().catch(() => {});
        state.activeQuery = null;
      }

      state.abortController.abort();

      for (const [, req] of state.pendingRequests) {
        yield* Deferred.succeed(req.deferred, { type: "deny" as const, reason: "Session stopped" });
      }

      self.sessions.delete(threadId as string);

      yield* Effect.tryPromise({
        try: () =>
          self.enqueue(
            self.makeEnvelope("session.exited", threadId, { reason: "stopped" })
          ),
        catch: (e) =>
          new ProcessError({
            threadId,
            message: `Failed to emit session.exited: ${e}`,
            recoverable: false,
          }),
      });
    });
  }

  stopAll(): Effect.Effect<void, AdapterError> {
    const self = this;
    return Effect.gen(function* () {
      const threadIds = Array.from(self.sessions.keys());
      for (const id of threadIds) {
        yield* self.stopSession(ThreadId(id));
      }
    });
  }

  sendTurn(input: SendTurnInput): Effect.Effect<TurnStartResult, AdapterError> {
    const self = this;
    return Effect.gen(function* () {
      const state = self.sessions.get(input.threadId as string);
      if (!state) {
        return yield* Effect.fail(new SessionNotFoundError({ threadId: input.threadId }));
      }

      const turnId = TurnId(randomUUID());

      yield* Effect.tryPromise({
        try: () =>
          self.enqueue(
            self.makeEnvelope("turn.started", input.threadId, { turnId }, turnId)
          ),
        catch: (e) =>
          new ProcessError({
            threadId: input.threadId,
            message: `Failed to emit turn.started: ${e}`,
            recoverable: false,
          }),
      });

      // Fire off the Agent SDK query in the background
      self.runAgentQuery(state, input.text, turnId, input.model, input.effort, {
        forkSession: input.forkSession,
        continueSession: input.continueSession,
        outputFormat: input.outputFormat,
      }).catch((err) => {
        self.enqueue(
          self.makeEnvelope("runtime.error", input.threadId, {
            message: err?.message ?? String(err),
            recoverable: true,
          }, turnId)
        );
      });

      return { turnId: turnId as string };
    });
  }

  private async writePluginInstructions(cwd: string, userId?: string): Promise<void> {
    if (!userId) return;
    try {
      const installed = await prisma.installedPlugin.findMany({
        where: { userId },
        include: { plugin: true },
      });
      if (installed.length === 0) return;

      const sections = installed
        .filter((ip) => ip.plugin.instructions)
        .map((ip) => ip.plugin.instructions!);

      if (sections.length === 0) return;

      const claudeMd = `# Installed Plugins\n\n${sections.join("\n\n---\n\n")}\n`;

      // Read existing CLAUDE.md if present and preserve user content
      const claudeMdPath = join(cwd, "CLAUDE.md");
      let existingContent = "";
      try {
        existingContent = readFileSync(claudeMdPath, "utf-8");
      } catch {
        // No existing CLAUDE.md
      }

      // Replace the managed plugin section, or append
      const MARKER_START = "<!-- PATCHWORK_PLUGINS_START -->";
      const MARKER_END = "<!-- PATCHWORK_PLUGINS_END -->";
      const pluginBlock = `${MARKER_START}\n${claudeMd}\n${MARKER_END}`;

      if (existingContent.includes(MARKER_START)) {
        const before = existingContent.slice(0, existingContent.indexOf(MARKER_START));
        const afterIdx = existingContent.indexOf(MARKER_END);
        const after = afterIdx >= 0 ? existingContent.slice(afterIdx + MARKER_END.length) : "";
        writeFileSync(claudeMdPath, before + pluginBlock + after);
      } else if (existingContent) {
        writeFileSync(claudeMdPath, existingContent + "\n\n" + pluginBlock);
      } else {
        writeFileSync(claudeMdPath, pluginBlock);
      }

      console.log(`[claude-adapter] Wrote ${installed.length} plugin instructions to ${claudeMdPath}`);
    } catch (err: any) {
      console.error("[claude-adapter] Failed to write plugin instructions:", err.message);
    }
  }

  private async runAgentQuery(
    state: SessionState,
    text: string,
    turnId: TurnId,
    model?: string,
    effort?: string,
    extra?: {
      forkSession?: boolean;
      continueSession?: boolean;
      outputFormat?: { type: "json_schema"; schema: Record<string, unknown> };
    },
  ): Promise<void> {
    const threadId = state.session.threadId;
    const isFullAccess = state.session.runtimeMode === "full-access";

    // Start with process.env so the CLI inherits PATH, HOME, CLAUDE_CONFIG_DIR, etc.
    const env: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter((e): e is [string, string] => e[1] != null)
      ),
    };
    // Only set API key if NOT using subscription mode.
    if (state.session.apiKey && !state.session.useSubscription) {
      env.ANTHROPIC_API_KEY = state.session.apiKey;
    } else {
      delete env.ANTHROPIC_API_KEY;
    }
    if (state.session.githubToken) {
      env.GITHUB_TOKEN = state.session.githubToken;
    }

    // Secure deployment: Support credential proxying via ANTHROPIC_BASE_URL.
    // When set, the SDK routes API calls through a proxy that injects credentials,
    // so the agent container never sees the actual API key.
    if (process.env.ANTHROPIC_BASE_URL) {
      env.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL;
    }

    const cwd = state.session.workspacePath || "/workspace";
    if (!existsSync(cwd)) {
      mkdirSync(cwd, { recursive: true });
    }

    // Write installed plugin instructions to CLAUDE.md in the workspace
    await this.writePluginInstructions(cwd, state.session.userId);

    // Set up .claude/ directory with skills, slash commands, and settings
    try {
      let projectMeta: { name?: string; repo?: string; branch?: string } = {};
      if (state.session.projectId) {
        const project = await prisma.project.findUnique({
          where: { id: state.session.projectId },
          select: { name: true, repo: true, branch: true },
        });
        if (project) {
          projectMeta = { name: project.name, repo: project.repo ?? undefined, branch: project.branch ?? undefined };
        }
      }
      setupWorkspaceClaudeConfig(cwd, {
        projectName: projectMeta.name,
        repo: projectMeta.repo,
        branch: projectMeta.branch,
      });
    } catch (err: any) {
      console.error("[claude-adapter] Failed to set up workspace config:", err.message);
    }

    // Enable agent teams feature flag
    env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = "1";

    // Determine permission mode based on runtime mode and environment.
    // The CLI blocks --dangerously-skip-permissions when running as root,
    // so we use "dontAsk" (auto-approves all tools) instead of "bypassPermissions"
    // when running in a server container as root.
    const isRoot = process.getuid?.() === 0;
    let permissionMode: string;
    if (isFullAccess) {
      permissionMode = isRoot ? "dontAsk" : "bypassPermissions";
    } else {
      permissionMode = "plan";
    }

    // --- Cycle awareness ---
    let cyclePromptSection = "";

    cyclePromptSection += [
      "",
      "# Development Cycles",
      "",
      "You have access to structured development cycles that enforce quality gates.",
      "When a task matches a cycle, announce it and activate it using the `cycle_start` tool.",
      "",
      "Available cycles:",
      "- **feature-dev**: New features, enhancements, refactors",
      "- **debug**: Bug fixes, error investigation",
      "- **code-review**: Review existing code/PR",
      "- **production-check**: Pre-deploy verification",
      "",
      "When activating a cycle, use `cycle_start` with the cycle ID.",
      "For small/routine tasks, you may skip spec and plan phases via `cycle_skip`.",
    ].join("\n");

    try {
      const activeCycle = await prisma.cycleRun.findFirst({
        where: { threadId, status: "running" },
      });
      if (activeCycle) {
        const blueprint = getBlueprint(activeCycle.blueprintId);
        if (blueprint) {
          const currentNode = blueprint.nodes[activeCycle.currentNodeIndex];
          if (currentNode) {
            const phasePrompt = currentNode.prompt || `Execute the "${currentNode.name}" phase.`;
            const phaseProgress = blueprint.nodes
              .map((n, i) => {
                if (i < activeCycle.currentNodeIndex) return `✓ ${n.name}`;
                if (i === activeCycle.currentNodeIndex) return `● ${n.name} (current)`;
                return `○ ${n.name}`;
              })
              .join(" → ");

            cyclePromptSection += [
              "",
              "",
              `## Active Cycle: ${blueprint.name}`,
              "",
              `Progress: ${phaseProgress}`,
              "",
              `### Current Phase: ${currentNode.name} (${activeCycle.currentNodeIndex + 1}/${blueprint.nodes.length})`,
              "",
              phasePrompt,
              "",
              "Use `cycle_advance` when this phase is complete.",
            ].join("\n");
          }
        }
      }
    } catch {
      // Non-fatal — proceed without cycle prompt
    }

    // --- Anki: staleness check + TOC generation ---
    let ankiTocSection = "";
    if (state.session.projectId) {
      // Run staleness check only once per session (not every turn)
      if (!(state as any).ankiStalenessChecked) {
        await runAnkiStalenessCheck(state.session.projectId, cwd);
        (state as any).ankiStalenessChecked = true;
      }

      const cards = await prisma.ankiCard.findMany({
        where: { projectId: state.session.projectId },
        orderBy: { accessCount: "desc" },
        take: 50,
        select: {
          group: true,
          title: true,
          accessCount: true,
          stale: true,
          staleReason: true,
        },
      });

      const totalCount = await prisma.ankiCard.count({
        where: { projectId: state.session.projectId },
      });

      if (cards.length > 0) {
        const tocRows = cards
          .map((c) => {
            const status = c.stale ? `STALE: ${c.staleReason ?? "unknown"}` : "✓";
            return `| ${c.group} | ${c.title} | ${c.accessCount} | ${status} |`;
          })
          .join("\n");

        const truncNote = totalCount > 50 ? `\n\n*Showing top 50 of ${totalCount} cards. Use \`anki_list\` to see all.*` : "";

        ankiTocSection = [
          "",
          "# Project Knowledge (Anki)",
          "",
          "You have access to a project-wide knowledge base. The current card index:",
          "",
          "| Group | Title | Reads | Status |",
          "|-------|-------|-------|--------|",
          tocRows,
          truncNote,
          "",
          "Use `anki_read` to fetch any card's full contents when relevant to your task.",
          "Use `anki_write` to record architecture decisions, debugging findings, guidance, or patterns you discover.",
          "Use `anki_invalidate` when you discover a card's information is wrong.",
          "Use `anki_delete` to remove cards that are no longer relevant.",
          "",
          "When writing cards:",
          "- Choose a descriptive group (architecture, guidance, debugging, patterns, etc.)",
          "- Title should be specific and searchable",
          "- Include file paths in referencedFiles so staleness detection works",
          "- Prefer updating an existing card over creating a near-duplicate",
          "- After completing a significant task, consider what knowledge is worth preserving for other threads",
        ].join("\n");
      }
    }

    // Build system prompt: threads get the Claude Code preset with cycle + anki info,
    // issues get additional autonomous instructions appended
    const systemPrompt = isFullAccess
      ? {
          type: "preset" as const,
          preset: "claude_code" as const,
          append: [
            "# Autonomous Mode",
            "",
            "You are running autonomously on a dispatched issue. There is NO human operator watching — do NOT ask questions, do NOT use AskUserQuestion, do NOT wait for confirmation.",
            "",
            "## Behavioral Rules",
            "- Make reasonable decisions and implement. If something is ambiguous, pick the most sensible approach and note your reasoning in a code comment or commit message.",
            "- Commit frequently with clear conventional-commit messages (feat:, fix:, refactor:, etc.).",
            "- Run tests after making changes. If tests fail, fix them before moving on.",
            "- Keep changes focused on the issue — don't refactor unrelated code.",
            "- If you get stuck or blocked, leave a clear TODO comment explaining the blocker and move on to what you can complete.",
            "- When done, ensure all changes are committed. Do NOT push — the system handles push and PR creation automatically.",
          ].join("\n") + cyclePromptSection + ankiTocSection,
        }
      : {
          type: "preset" as const,
          preset: "claude_code" as const,
          append: [cyclePromptSection, ankiTocSection].filter(Boolean).join("") || undefined,
        };

    const opts: Record<string, unknown> = {
      model: model ?? state.session.model ?? "claude-opus-4-6",
      cwd,
      permissionMode,
      // No maxTurns or maxBudgetUsd — let the agent loop run until the task is complete
      effort: effort || "high",
      abortController: state.abortController,
      env,
      includePartialMessages: true,
      // Load project settings (.claude/ directory) for skills, commands, settings
      settingSources: ["project"],
      // File checkpointing: enables rewindFiles() for undo support
      enableFileCheckpointing: true,
      systemPrompt,
    };

    // --- Subagents ---
    // Pre-defined specialist agents the main agent can dispatch via the Agent tool
    opts.agents = getSubagentDefinitions(cwd);

    // --- Programmatic hooks ---
    // Intercept tool execution for audit logging, dangerous command blocking, and notifications
    const hookCtx = {
      threadId,
      turnId,
      enqueue: this.enqueue.bind(this),
      makeEnvelope: this.makeEnvelope.bind(this),
    };
    opts.hooks = createAgentHooks(hookCtx);

    // --- Custom tools via MCP server ---
    // Expose Patchwork-specific tools (project info, issue management, etc.)
    try {
      const mcpServer = await createPatchworkMcpServer({
        threadId: threadId as string,
        projectId: state.session.projectId,
        userId: state.session.userId,
        workspacePath: cwd,
      });
      if (mcpServer) {
        opts.mcpServers = [mcpServer];
      }
    } catch (err: any) {
      console.log(`[claude-adapter] Custom tools not available: ${err.message}`);
    }

    // --- Session fork/continue ---
    if (extra?.forkSession) {
      opts.forkSession = true;
    }
    if (extra?.continueSession) {
      opts.continue = true;
    }

    // --- Structured outputs ---
    if (extra?.outputFormat) {
      opts.outputFormat = extra.outputFormat;
    }

    // Only set bypass flags when NOT running as root (root can't use them)
    if (isFullAccess && !isRoot) {
      opts.allowDangerouslySkipPermissions = true;
      opts.dangerouslySkipPermissions = true;
    }

    if (isFullAccess) {
      opts.allowedTools = [
        "Read", "Edit", "Write", "Bash", "Glob", "Grep",
        "WebSearch", "WebFetch", "TodoWrite", "Agent", "Skill",
      ];
    }

    if (state.session.resumeCursor && !extra?.forkSession) {
      opts.resume = state.session.resumeCursor;
    }

    // Wire up approval callback for approval-required mode (plan)
    // Also handles AskUserQuestion — surfaces clarifying questions to the UI
    if (permissionMode === "plan") {
      const self = this;
      opts.canUseTool = async (
        toolName: string,
        input: Record<string, unknown>,
        context: { toolUseID: string; signal: AbortSignal },
      ) => {
        // Auto-approve if user already chose "Allow All"
        if (state.autoApproveAll) {
          return { behavior: "allow" as const, updatedInput: input };
        }

        const requestId = context.toolUseID || randomUUID();

        // --- AskUserQuestion handling ---
        // When the agent wants to ask the user a clarifying question,
        // we surface it as an interactive prompt in the UI
        if (toolName === "AskUserQuestion") {
          const questions = (input.questions as Array<{
            question: string;
            options: Array<{ label: string; value: string }>;
          }>) ?? [];

          if (questions.length > 0) {
            const q = questions[0]; // Surface the first question
            await self.enqueue(
              self.makeEnvelope("ask_user", threadId, {
                turnId,
                requestId,
                question: q.question,
                options: q.options ?? [],
              }, turnId)
            );
          }

          // Still route through normal approval flow for the answer
          await self.enqueue(
            self.makeEnvelope("request.opened", threadId, {
              requestId,
              toolName,
              toolCategory: "dynamic_tool_call",
              description: "Agent is asking a question",
              input,
            }, turnId)
          );

          // Emit transient thread.status for project-level notifications
          // Look up thread name for the toast notification
          const threadRecord = await prisma.thread.findUnique({
            where: { id: threadId as string },
            select: { title: true },
          });
          await self.enqueue(
            self.makeEnvelope("thread.status", threadId, {
              status: "needs_input",
              requestId,
              question: questions.length > 0 ? questions[0].question : "Agent needs input",
              options: questions.length > 0 ? questions[0].options : [],
              threadName: threadRecord?.title ?? undefined,
            }, turnId)
          );

          const deferred = Effect.runSync(Deferred.make<ApprovalDecision, never>());
          state.pendingRequests.set(requestId, { requestId, deferred });

          const decision = await Effect.runPromise(Deferred.await(deferred));
          state.pendingRequests.delete(requestId);

          await self.enqueue(
            self.makeEnvelope("request.resolved", threadId, {
              requestId,
              decision: decision.type,
            }, turnId)
          );

          // Emit thread.status running to clear notifications
          await self.enqueue(
            self.makeEnvelope("thread.status", threadId, {
              status: "running",
            }, turnId)
          );

          if (decision.type === "deny") {
            return { behavior: "deny" as const, message: decision.reason ?? "User declined" };
          }

          // For AskUserQuestion, pass the user's answer back via updatedInput
          // The reason field carries the user's response text
          const reason = "reason" in decision ? decision.reason : undefined;
          return {
            behavior: "allow" as const,
            updatedInput: { ...input, result: reason ?? "" },
          };
        }

        // --- Standard approval flow ---
        await self.enqueue(
          self.makeEnvelope("request.opened", threadId, {
            requestId,
            toolName,
            toolCategory: classifyTool(toolName),
            description: `${toolName} wants to execute`,
            input,
          }, turnId)
        );

        const deferred = Effect.runSync(Deferred.make<ApprovalDecision, never>());
        state.pendingRequests.set(requestId, { requestId, deferred });

        const decision = await Effect.runPromise(Deferred.await(deferred));
        state.pendingRequests.delete(requestId);

        await self.enqueue(
          self.makeEnvelope("request.resolved", threadId, {
            requestId,
            decision: decision.type,
          }, turnId)
        );

        if (decision.type === "allow_session") {
          state.autoApproveAll = true;
          return { behavior: "allow" as const, updatedInput: input };
        }

        if (decision.type === "deny") {
          return { behavior: "deny" as const, message: decision.reason ?? "User denied" };
        }

        return { behavior: "allow" as const, updatedInput: input };
      };
    }

    console.log(`[claude-adapter] Starting query: model=${opts.model} cwd=${opts.cwd} permissionMode=${opts.permissionMode} agents=${(opts.agents as any[])?.length ?? 0} hooks=true checkpointing=true`);

    const q = query({ prompt: text, options: opts as any });
    state.activeQuery = q;

    // Track whether stream events actually deliver text deltas (not just lifecycle events).
    // Only set when we get a content_block_delta with text_delta — prevents falsely
    // suppressing the partial-message fallback path.
    let hasStreamTextDeltas = false;
    // Track accumulated text length from partial assistant messages for delta computation.
    // Partial messages contain the full text so far; we compute the new delta by slicing.
    let partialTextLen = 0;
    // Track active tool items for completion (id → toolName)
    const activeItems = new Map<string, string>();

    try {
      for await (const message of q) {
        if (message.type === "stream_event") {
          const streamEvent = (message as any).event;

          // Only flag stream text when we actually receive text content
          if (
            streamEvent?.type === "content_block_delta" &&
            streamEvent.delta?.type === "text_delta" &&
            streamEvent.delta.text
          ) {
            hasStreamTextDeltas = true;
          }

          // Reset partial text tracking when a new text content block starts
          if (
            streamEvent?.type === "content_block_start" &&
            streamEvent.content_block?.type === "text"
          ) {
            partialTextLen = 0;

            // Complete pending tool items when text resumes after tool execution
            if (activeItems.size > 0) {
              for (const [itemId, toolName] of activeItems) {
                await this.enqueue(
                  this.makeEnvelope("item.completed", threadId, { itemId, turnId, toolName }, turnId)
                );
              }
              activeItems.clear();
            }
          }
        }

        const envelopes = this.mapSDKMessage(message, threadId, turnId, hasStreamTextDeltas);

        // Fallback: extract text from partial assistant messages when stream events
        // don't include text deltas. Compute true deltas from accumulated text.
        if (!hasStreamTextDeltas && message.type === "assistant") {
          const betaMessage = (message as any).message;
          if (betaMessage?.content) {
            let fullText = "";
            for (const block of betaMessage.content) {
              if (block.type === "text" && block.text) {
                fullText += block.text;
              }
            }
            if (fullText.length > partialTextLen) {
              const delta = fullText.slice(partialTextLen);
              partialTextLen = fullText.length;
              envelopes.push(
                this.makeEnvelope("content.delta", threadId, {
                  turnId, kind: "text", delta,
                }, turnId)
              );
            }
          }
        }

        // Track items for completion
        for (const env of envelopes) {
          if (env.type === "item.started") {
            const p = env.payload as { itemId: string; toolName: string };
            activeItems.set(p.itemId, p.toolName);
          }
        }

        for (const env of envelopes) {
          await this.enqueue(env);
        }

        // Capture session_id and actual model from init for resume support
        if (message.type === "system" && (message as any).subtype === "init") {
          const sdkSessionId = (message as any).session_id;
          state.session.resumeCursor = sdkSessionId;
          const actualModel = (message as any).model;
          if (actualModel) {
            console.log(`[claude-adapter] SDK init: model=${actualModel} session=${sdkSessionId}`);
          }
          // Persist session_id to DB for resume across server restarts
          if (sdkSessionId) {
            prisma.threadSession.updateMany({
              where: { threadId: threadId as string, status: "active" },
              data: { resumeCursor: sdkSessionId },
            }).catch(() => {});
          }
        }

        // --- Todo tracking ---
        // Detect TodoWrite tool usage in assistant messages and emit todo.updated events
        if (message.type === "assistant") {
          const betaMessage = (message as any).message;
          if (betaMessage?.content) {
            for (const block of betaMessage.content) {
              if (block.type === "tool_use" && block.name === "TodoWrite") {
                const todoInput = block.input as {
                  todos?: Array<{ id: string; content: string; status: string }>;
                };
                if (todoInput.todos) {
                  for (const todo of todoInput.todos) {
                    state.todos.set(todo.id, {
                      content: todo.content,
                      status: todo.status,
                    });
                  }
                  // Emit consolidated todo update
                  const todoList = Array.from(state.todos.entries()).map(([id, t]) => ({
                    id,
                    content: t.content,
                    status: t.status as "pending" | "in_progress" | "completed",
                  }));
                  await this.enqueue(
                    this.makeEnvelope("todo.updated", threadId, {
                      turnId,
                      todos: todoList,
                    }, turnId)
                  );
                }
              }
            }
          }
        }

        // --- SendMessage interception ---
        // Route inter-agent messages to target thread and persist to DB
        if (message.type === "assistant") {
          const betaMessage = (message as any).message;
          if (betaMessage?.content) {
            for (const block of betaMessage.content) {
              if (block.type === "tool_use" && block.name === "SendMessage") {
                const input = block.input as Record<string, unknown>;
                const teamId = state.session.teamId;
                if (teamId) {
                  const targetName = (input as any).teammate_name || (input as any).to;
                  const msgContent = (input as any).content || (input as any).message || "";

                  try {
                    const targetMember = await prisma.teamMember.findFirst({
                      where: { teamId, name: targetName },
                    });
                    const fromMember = await prisma.teamMember.findFirst({
                      where: { teamId, threadId: threadId as string },
                    });

                    if (targetMember && msgContent) {
                      await prisma.teamMessage.create({
                        data: {
                          teamId,
                          fromThreadId: threadId as string,
                          toThreadId: targetMember.threadId,
                          content: msgContent,
                        },
                      });

                      // Emit to target thread's WS clients
                      await this.enqueue(
                        this.makeEnvelope("team.message.received", ThreadId(targetMember.threadId), {
                          teamId,
                          fromThreadId: threadId as string,
                          fromName: fromMember?.name ?? "unknown",
                          content: msgContent,
                          toThreadId: targetMember.threadId,
                        }, turnId)
                      );

                      // Also emit to sender's WS clients
                      await this.enqueue(
                        this.makeEnvelope("team.message.received", threadId, {
                          teamId,
                          fromThreadId: threadId as string,
                          fromName: fromMember?.name ?? "unknown",
                          content: msgContent,
                          toThreadId: targetMember.threadId,
                        }, turnId)
                      );
                    }
                  } catch (err: any) {
                    console.warn("[claude-adapter] SendMessage routing failed:", err.message);
                  }
                }
              }
            }
          }
        }

        // --- File checkpointing ---
        // Track checkpoint UUIDs from result messages for rewind support
        if (message.type === "result" && (message as any).checkpoint_id) {
          const checkpointId = (message as any).checkpoint_id;
          state.checkpoints.push(checkpointId);
          await this.enqueue(
            this.makeEnvelope("checkpoint.created", threadId, {
              turnId,
              checkpointId,
            }, turnId)
          );
        }
      }

      // Complete any remaining tool items
      for (const [itemId, toolName] of activeItems) {
        await this.enqueue(
          this.makeEnvelope("item.completed", threadId, { itemId, turnId, toolName }, turnId)
        );
      }

      // Emit diff after turn completes
      try {
        const rawDiff = execFileSync("git", ["diff", "HEAD"], {
          cwd,
          encoding: "utf-8",
          timeout: 10_000,
        });
        if (rawDiff.trim()) {
          const files = parseDiff(rawDiff);
          await this.enqueue(
            this.makeEnvelope("diff.updated", threadId, {
              turnId,
              diff: rawDiff,
              files,
            }, turnId)
          );
        }
      } catch {
        // Ignore diff errors (e.g. not a git repo)
      }

      await this.enqueue(
        this.makeEnvelope("turn.completed", threadId, { turnId }, turnId)
      );
    } catch (err: any) {
      if (err?.name === "AbortError") return;

      // Produce a more descriptive error for common failure modes
      let errorMessage = err?.message ?? String(err);
      if (errorMessage.includes("exited with code 1")) {
        if (!env.ANTHROPIC_API_KEY) {
          errorMessage = "Claude Code process exited — no API key configured. Please add your Anthropic API key in Settings, or ensure the server has ANTHROPIC_API_KEY set.";
        } else {
          errorMessage = "Claude Code process exited unexpectedly. Check server logs for details.";
        }
      }

      console.error(`[claude-adapter] Query error for thread=${threadId}:`, err?.message ?? err);
      await this.enqueue(
        this.makeEnvelope("runtime.error", threadId, {
          message: errorMessage,
          recoverable: true,
        }, turnId)
      );
      // Emit turn.completed so the UI stops showing "Working" state
      await this.enqueue(
        this.makeEnvelope("turn.completed", threadId, { turnId }, turnId)
      );
    } finally {
      state.activeQuery = null;
    }
  }

  /**
   * Map SDK messages to provider event envelopes.
   * Text from assistant messages is handled in runAgentQuery (delta computation
   * needed for partial messages). This method handles stream_event text/thinking
   * deltas and tool_use blocks from assistant messages.
   */
  private mapSDKMessage(
    message: any,
    threadId: ThreadId,
    turnId: TurnId,
    hasStreamTextDeltas: boolean = false,
  ): ProviderEventEnvelope[] {
    const envelopes: ProviderEventEnvelope[] = [];

    if (message.type === "stream_event") {
      const event = (message as any).event;

      if (event?.type === "content_block_delta") {
        if (event.delta?.type === "text_delta" && event.delta.text) {
          envelopes.push(
            this.makeEnvelope("content.delta", threadId, {
              turnId, kind: "text", delta: event.delta.text,
            }, turnId)
          );
        } else if (event.delta?.type === "thinking_delta" && event.delta.thinking) {
          envelopes.push(
            this.makeEnvelope("content.delta", threadId, {
              turnId, kind: "reasoning", delta: event.delta.thinking,
            }, turnId)
          );
        }
      }
    } else if (message.type === "assistant") {
      const betaMessage = message.message;
      if (betaMessage?.content) {
        for (const block of betaMessage.content) {
          // Text blocks are handled in runAgentQuery with proper delta computation
          // for partial messages. Stream event text deltas are handled above.
          if (block.type === "tool_use") {
            envelopes.push(
              this.makeEnvelope("item.started", threadId, {
                turnId,
                itemId: block.id ?? randomUUID(),
                toolName: block.name ?? "unknown",
                toolCategory: classifyTool(block.name ?? "unknown"),
                input: block.input ?? {},
              }, turnId, message)
            );
          // Thinking blocks: same as text — stream events handle deltas,
          // skip the full-block fallback to avoid duplication
          }
        }
      }
    } else if (message.type === "result") {
      if (message.is_error || message.subtype?.startsWith("error")) {
        const errorMsg = message.result || message.errors?.join("; ") || message.subtype || "Unknown error";
        console.error(`[claude-adapter] Result error for thread=${threadId}: ${errorMsg}`);
        envelopes.push(
          this.makeEnvelope("runtime.error", threadId, {
            message: errorMsg,
            recoverable: true,
          }, turnId, message)
        );
      } else if (message.subtype === "success") {
        envelopes.push(
          this.makeEnvelope("session.configured", threadId, {
            sessionId: message.session_id,
            totalCostUsd: message.total_cost_usd,
            usage: message.usage,
            numTurns: message.num_turns,
          }, turnId, message)
        );
      } else if (message.subtype === "error_max_budget_usd" || message.subtype === "error_max_turns") {
        envelopes.push(
          this.makeEnvelope("runtime.error", threadId, {
            message: `Agent loop stopped: ${message.subtype}. Send another message to continue.`,
            recoverable: true,
          }, turnId, message)
        );
      }
    } else if (message.type === "system" && (message as any).subtype === "init") {
      envelopes.push(
        this.makeEnvelope("session.configured", threadId, {
          sessionId: (message as any).session_id,
        }, turnId, message)
      );
    } else if (message.type === "system" && (message as any).subtype === "compact_boundary") {
      envelopes.push(
        this.makeEnvelope("context.compacted", threadId, {
          turnId,
          message: "Context compacted — prior conversation was summarized",
        }, turnId, message)
      );
    }

    return envelopes;
  }

  interruptTurn(threadId: ThreadId): Effect.Effect<void, AdapterError> {
    const self = this;
    return Effect.gen(function* () {
      const state = self.sessions.get(threadId as string);
      if (!state) {
        return yield* Effect.fail(new SessionNotFoundError({ threadId }));
      }
      if (state.activeQuery) {
        yield* Effect.tryPromise({
          try: () => state.activeQuery!.interrupt(),
          catch: () =>
            new ProcessError({
              threadId,
              message: "Failed to interrupt query",
              recoverable: true,
            }),
        });
      }
    });
  }

  respondToRequest(
    threadId: ThreadId,
    requestId: string,
    decision: ApprovalDecision
  ): Effect.Effect<void, AdapterError> {
    const self = this;
    return Effect.gen(function* () {
      const state = self.sessions.get(threadId as string);
      if (!state) {
        return yield* Effect.fail(new SessionNotFoundError({ threadId }));
      }

      const pending = state.pendingRequests.get(requestId);
      if (!pending) return;

      yield* Deferred.succeed(pending.deferred, decision);
    });
  }

  readThread(threadId: ThreadId): Effect.Effect<ThreadSnapshot, AdapterError> {
    return Effect.succeed({ threadId, events: [] });
  }

  rollbackThread(
    threadId: ThreadId,
    _numTurns: number
  ): Effect.Effect<ThreadSnapshot, AdapterError> {
    return Effect.succeed({ threadId, events: [] });
  }
}
