import { Effect, Stream, Queue, Deferred } from "effect";
import { randomUUID } from "node:crypto";
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
  session: ProviderSession;
  abortController: AbortController;
  pendingRequests: Map<string, PendingRequest>;
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
  private eventQueue: Queue.Queue<ProviderEventEnvelope> | null = null;

  private sdkModule: any = null;

  private async getSDK() {
    if (!this.sdkModule) {
      try {
        this.sdkModule = await import("@anthropic-ai/claude-code" as any);
      } catch {
        try {
          this.sdkModule = await import("@anthropic-ai/claude-agent-sdk" as any);
        } catch {
          throw new Error(
            "Claude Agent SDK not installed. Install @anthropic-ai/claude-code or @anthropic-ai/claude-agent-sdk."
          );
        }
      }
    }
    return this.sdkModule;
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
    if (this.eventQueue) {
      await Effect.runPromise(Queue.offer(this.eventQueue, envelope));
    }
  }

  get streamEvents(): Stream.Stream<ProviderEventEnvelope, AdapterError> {
    const self = this;
    return Stream.unwrap(
      Effect.gen(function* () {
        if (!self.eventQueue) {
          self.eventQueue = yield* Queue.unbounded<ProviderEventEnvelope>();
        }
        return Stream.fromQueue(self.eventQueue);
      })
    );
  }

  startSession(input: SessionStartInput): Effect.Effect<ProviderSession, AdapterError> {
    const self = this;
    return Effect.gen(function* () {
      const sessionId = randomUUID();

      const session: ProviderSession = {
        threadId: input.threadId,
        provider: "claudeCode",
        sessionId,
        model: input.model ?? "claude-sonnet-4-20250514",
        runtimeMode: input.runtimeMode,
        resumeCursor: input.resumeCursor,
      };

      const state: SessionState = {
        session,
        abortController: new AbortController(),
        pendingRequests: new Map(),
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

      // Fire off the SDK query in the background (don't await — events stream to queue)
      self.runQuery(state, input, turnId).catch((err) => {
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

  private async runQuery(
    state: SessionState,
    input: SendTurnInput,
    turnId: TurnId
  ): Promise<void> {
    const sdk = await this.getSDK();
    const threadId = state.session.threadId;
    const isFullAccess = state.session.runtimeMode === "full-access";

    try {
      const options: Record<string, unknown> = {
        prompt: input.text,
        model: input.model ?? state.session.model,
        abortSignal: state.abortController.signal,
      };

      if (isFullAccess) {
        options.allowedTools = ["*"];
      }

      if (state.session.resumeCursor) {
        options.resume = state.session.resumeCursor;
      }

      const result = sdk.query ? sdk.query(options) : sdk.default?.query?.(options);
      if (!result) throw new Error("SDK query() not available");

      for await (const message of result) {
        if (state.abortController.signal.aborted) break;

        const envelopes = this.mapSDKMessage(message, threadId, turnId);
        for (const env of envelopes) {
          await this.enqueue(env);
        }
      }

      await this.enqueue(
        this.makeEnvelope("turn.completed", threadId, { turnId }, turnId)
      );
    } catch (err: any) {
      if (err?.name === "AbortError") return;

      await this.enqueue(
        this.makeEnvelope("runtime.error", threadId, {
          message: err?.message ?? String(err),
          recoverable: true,
        }, turnId)
      );
    }
  }

  private mapSDKMessage(
    message: any,
    threadId: ThreadId,
    turnId: TurnId
  ): ProviderEventEnvelope[] {
    const envelopes: ProviderEventEnvelope[] = [];

    if (message.type === "text" || message.type === "content_block_delta") {
      const delta = message.text ?? message.delta?.text ?? "";
      if (delta) {
        envelopes.push(
          this.makeEnvelope("content.delta", threadId, {
            turnId, kind: "text", delta,
          }, turnId, message)
        );
      }
    } else if (message.type === "thinking" || message.type === "reasoning") {
      const delta = message.thinking ?? message.text ?? "";
      if (delta) {
        envelopes.push(
          this.makeEnvelope("content.delta", threadId, {
            turnId, kind: "reasoning", delta,
          }, turnId, message)
        );
      }
    } else if (message.type === "tool_use") {
      envelopes.push(
        this.makeEnvelope("item.started", threadId, {
          turnId,
          itemId: message.id ?? randomUUID(),
          toolName: message.name ?? "unknown",
          toolCategory: classifyTool(message.name ?? "unknown"),
          input: message.input ?? {},
        }, turnId, message)
      );
    } else if (message.type === "tool_result") {
      envelopes.push(
        this.makeEnvelope("item.completed", threadId, {
          turnId,
          itemId: message.tool_use_id ?? randomUUID(),
          toolName: message.name ?? "unknown",
          output: message.content,
          error: message.is_error ? String(message.content) : undefined,
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
      state.abortController.abort();
      state.abortController = new AbortController();
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
