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
  };
  abortController: AbortController;
  pendingRequests: Map<string, PendingRequest>;
  activeQuery: ReturnType<typeof query> | null;
  /** When true, all tools are auto-approved for this session */
  autoApproveAll: boolean;
}

export class ClaudeCodeAdapter implements ProviderAdapterShape {
  readonly provider = "claudeCode" as const;
  readonly capabilities: ProviderCapabilities = {
    sessionModelSwitch: "restart-session",
    supportsApprovals: true,
    supportsPlanMode: true,
    supportsResume: true,
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
      };

      const state: SessionState = {
        session,
        abortController: new AbortController(),
        pendingRequests: new Map(),
        activeQuery: null,
        autoApproveAll: false,
      };

      self.sessions.set(input.threadId as string, state);

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
      self.runAgentQuery(state, input.text, turnId, input.model).catch((err) => {
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

    // bypassPermissions is blocked when running as root (security check in CLI).
    const isRoot = process.getuid?.() === 0;
    const canBypass = isFullAccess && !isRoot;

    const cwd = state.session.workspacePath || "/workspace";
    if (!existsSync(cwd)) {
      mkdirSync(cwd, { recursive: true });
    }

    // Write installed plugin instructions to CLAUDE.md in the workspace
    await this.writePluginInstructions(cwd, state.session.userId);

    const opts: Record<string, unknown> = {
      model: model ?? state.session.model ?? "claude-opus-4-6",
      cwd,
      permissionMode: canBypass ? "bypassPermissions" : "plan",
      allowDangerouslySkipPermissions: canBypass,
      maxTurns: 50,
      abortController: state.abortController,
      env,
      includePartialMessages: true,
      // Don't load user/project settings — our adapter controls permissions
      settingSources: [],
    };

    if (isFullAccess) {
      opts.allowedTools = [
        "Read", "Edit", "Write", "Bash", "Glob", "Grep",
        "WebSearch", "WebFetch",
      ];
    }

    if (state.session.resumeCursor) {
      opts.resume = state.session.resumeCursor;
    }

    // Wire up approval callback for non-bypass modes
    if (!canBypass) {
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

        // Emit request.opened to the UI
        await self.enqueue(
          self.makeEnvelope("request.opened", threadId, {
            requestId,
            toolName,
            toolCategory: classifyTool(toolName),
            description: `${toolName} wants to execute`,
            input,
          }, turnId)
        );

        // Create deferred and wait for user decision
        const deferred = Effect.runSync(Deferred.make<ApprovalDecision, never>());
        state.pendingRequests.set(requestId, { requestId, deferred });

        const decision = await Effect.runPromise(Deferred.await(deferred));
        state.pendingRequests.delete(requestId);

        // Emit request.resolved
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

    console.log(`[claude-adapter] Starting query: model=${opts.model} cwd=${opts.cwd} permissionMode=${opts.permissionMode}`);

    const q = query({ prompt: text, options: opts as any });
    state.activeQuery = q;

    // Track whether we're receiving stream events (for fallback logic)
    let hasStreamEvents = false;
    // Track active tool items for completion
    const activeItemIds: string[] = [];

    try {
      for await (const message of q) {
        if (message.type === "stream_event") {
          hasStreamEvents = true;
        }

        // When new text content starts after tool execution, complete pending items
        if (message.type === "stream_event") {
          const streamEvent = (message as any).event;
          if (
            streamEvent?.type === "content_block_start" &&
            streamEvent.content_block?.type === "text" &&
            activeItemIds.length > 0
          ) {
            for (const itemId of activeItemIds) {
              await this.enqueue(
                this.makeEnvelope("item.completed", threadId, { itemId, turnId }, turnId)
              );
            }
            activeItemIds.length = 0;
          }
        }

        const envelopes = this.mapSDKMessage(message, threadId, turnId, hasStreamEvents);

        // Track items for completion
        for (const env of envelopes) {
          if (env.type === "item.started") {
            activeItemIds.push((env.payload as { itemId: string }).itemId);
          }
        }

        for (const env of envelopes) {
          await this.enqueue(env);
        }

        // Capture session_id from init for resume support
        if (message.type === "system" && (message as any).subtype === "init") {
          state.session.resumeCursor = (message as any).session_id;
        }
      }

      // Complete any remaining tool items
      for (const itemId of activeItemIds) {
        await this.enqueue(
          this.makeEnvelope("item.completed", threadId, { itemId, turnId }, turnId)
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

      console.error(`[claude-adapter] Query error for thread=${threadId}:`, err?.message ?? err);
      await this.enqueue(
        this.makeEnvelope("runtime.error", threadId, {
          message: err?.message ?? String(err),
          recoverable: true,
        }, turnId)
      );
    } finally {
      state.activeQuery = null;
    }
  }

  /**
   * Map SDK messages to provider event envelopes.
   * When hasStreamEvents is true, text/thinking blocks in assistant messages
   * are skipped (already streamed via stream_event). Tool use blocks are
   * always processed from assistant messages since they contain full input.
   */
  private mapSDKMessage(
    message: any,
    threadId: ThreadId,
    turnId: TurnId,
    hasStreamEvents: boolean = false,
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
          if (block.type === "text" && !hasStreamEvents) {
            // Fallback: only emit full text if stream events aren't available
            envelopes.push(
              this.makeEnvelope("content.delta", threadId, {
                turnId, kind: "text", delta: block.text,
              }, turnId, message)
            );
          } else if (block.type === "tool_use") {
            envelopes.push(
              this.makeEnvelope("item.started", threadId, {
                turnId,
                itemId: block.id ?? randomUUID(),
                toolName: block.name ?? "unknown",
                toolCategory: classifyTool(block.name ?? "unknown"),
                input: block.input ?? {},
              }, turnId, message)
            );
          } else if (block.type === "thinking" && !hasStreamEvents) {
            // Fallback: only emit full thinking if stream events aren't available
            if (block.thinking) {
              envelopes.push(
                this.makeEnvelope("content.delta", threadId, {
                  turnId, kind: "reasoning", delta: block.thinking,
                }, turnId, message)
              );
            }
          }
        }
      }
    } else if (message.type === "result") {
      if (message.is_error || message.subtype?.startsWith("error")) {
        const errorMsg = message.result ?? message.errors?.join("; ") ?? message.subtype ?? "Unknown error";
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
          }, turnId, message)
        );
      }
    } else if (message.type === "system" && (message as any).subtype === "init") {
      envelopes.push(
        this.makeEnvelope("session.configured", threadId, {
          sessionId: (message as any).session_id,
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
