import { Effect, Stream, Queue, Deferred } from "effect";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
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
  };
  abortController: AbortController;
  pendingRequests: Map<string, PendingRequest>;
  activeQuery: ReturnType<typeof query> | null;
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
        model: input.model ?? "claude-sonnet-4-6",
        runtimeMode: input.runtimeMode,
        resumeCursor: input.resumeCursor,
        apiKey: input.apiKey,
        useSubscription: input.useSubscription,
        githubToken: input.githubToken,
        workspacePath: input.workspacePath,
      };

      const state: SessionState = {
        session,
        abortController: new AbortController(),
        pendingRequests: new Map(),
        activeQuery: null,
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

  private async runAgentQuery(
    state: SessionState,
    text: string,
    turnId: TurnId,
    model?: string,
  ): Promise<void> {
    const threadId = state.session.threadId;
    const isFullAccess = state.session.runtimeMode === "full-access";

    const env: Record<string, string> = {};
    // Only set API key if NOT using subscription mode.
    // Without ANTHROPIC_API_KEY, the CLI falls back to OAuth/subscription auth.
    if (state.session.apiKey && !state.session.useSubscription) {
      env.ANTHROPIC_API_KEY = state.session.apiKey;
    }
    if (state.session.githubToken) {
      env.GITHUB_TOKEN = state.session.githubToken;
    }

    const opts: Record<string, unknown> = {
      model: model ?? state.session.model ?? "claude-sonnet-4-6",
      cwd: state.session.workspacePath || "/workspace",
      permissionMode: isFullAccess ? "bypassPermissions" : "default",
      allowDangerouslySkipPermissions: isFullAccess,
      maxTurns: 50,
      abortController: state.abortController,
      env,
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

    console.log(`[claude-adapter] Starting query: model=${opts.model} cwd=${opts.cwd} permissionMode=${opts.permissionMode}`);

    const q = query({ prompt: text, options: opts as any });
    state.activeQuery = q;

    try {
      for await (const message of q) {
        console.log(`[claude-adapter] SDK message: type=${message.type} subtype=${(message as any).subtype ?? "none"}`);

        const envelopes = this.mapSDKMessage(message, threadId, turnId);
        for (const env of envelopes) {
          await this.enqueue(env);
        }

        // Capture session_id from init for resume support
        if (message.type === "system" && (message as any).subtype === "init") {
          state.session.resumeCursor = (message as any).session_id;
        }
      }

      // Emit diff after turn completes
      try {
        const cwd = state.session.workspacePath || "/workspace";
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

  private mapSDKMessage(
    message: any,
    threadId: ThreadId,
    turnId: TurnId
  ): ProviderEventEnvelope[] {
    const envelopes: ProviderEventEnvelope[] = [];

    if (message.type === "assistant") {
      // SDKAssistantMessage: message.message is a BetaMessage with content[]
      const betaMessage = message.message;
      if (betaMessage?.content) {
        for (const block of betaMessage.content) {
          if (block.type === "text") {
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
          } else if (block.type === "thinking") {
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
        // Handle errors — even when subtype is "success", is_error can be true
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
      // Use the SDK's interrupt method instead of aborting the controller
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
