import { Effect, Stream } from "effect";
import { randomUUID } from "node:crypto";
import prisma from "../db/prisma.js";
import { ProviderAdapterRegistry } from "./registry.js";
import type {
  SessionStartInput,
  SendTurnInput,
  ApprovalDecision,
  ProviderSession,
  TurnStartResult,
  ThreadSnapshot,
} from "./adapter.js";
import type { ProviderEventEnvelope } from "./events.js";
import {
  ThreadId,
  SessionNotFoundError,
  ValidationError,
} from "./types.js";
import type { ProviderKind, AdapterError } from "./types.js";

interface EnsureSessionOpts {
  apiKey?: string;
  githubToken?: string;
  useSubscription?: boolean;
}

export class ProviderService {
  private sequenceCounters = new Map<string, number>();

  constructor(private registry: ProviderAdapterRegistry) {}

  private nextSequence(threadId: string): number {
    const current = this.sequenceCounters.get(threadId) ?? 0;
    this.sequenceCounters.set(threadId, current + 1);
    return current;
  }

  createThread(input: {
    title: string;
    provider: ProviderKind;
    model?: string;
    runtimeMode: "approval-required" | "full-access";
    workspacePath: string;
    useSubscription: boolean;
    apiKey?: string;
    githubToken?: string;
    userId?: string;
    issueId?: string;
    repo?: string;
    branch?: string;
    devboxId?: string;
    projectId?: string;
    worktreePath?: string;
    worktreeBranch?: string;
  }): Effect.Effect<{ thread: any; session: ProviderSession }, AdapterError> {
    const self = this;
    return Effect.gen(function* () {
      const adapter = yield* self.registry.get(input.provider);

      const thread = yield* Effect.tryPromise({
        try: () =>
          prisma.thread.create({
            data: {
              title: input.title,
              provider: input.provider,
              model: input.model,
              runtimeMode: input.runtimeMode,
              status: "starting",
              workspacePath: input.workspacePath,
              userId: input.userId,
              issueId: input.issueId,
              repo: input.repo,
              branch: input.branch,
              devboxId: input.devboxId,
              projectId: input.projectId,
              worktreePath: input.worktreePath,
              worktreeBranch: input.worktreeBranch,
            },
          }),
        catch: (e) =>
          new ValidationError({ message: `Failed to create thread: ${e}` }),
      });

      const threadId = ThreadId(thread.id);

      const session = yield* adapter.startSession({
        threadId,
        provider: input.provider,
        model: input.model,
        runtimeMode: input.runtimeMode,
        workspacePath: input.workspacePath,
        useSubscription: input.useSubscription,
        apiKey: input.apiKey,
        githubToken: input.githubToken,
        repo: input.repo,
        branch: input.branch,
        userId: input.userId,
      });

      yield* Effect.tryPromise({
        try: () =>
          prisma.threadSession.create({
            data: {
              threadId: thread.id,
              provider: input.provider,
              model: session.model,
              status: "active",
            },
          }),
        catch: (e) =>
          new ValidationError({ message: `Failed to record session: ${e}` }),
      });

      yield* Effect.tryPromise({
        try: () =>
          prisma.thread.update({
            where: { id: thread.id },
            data: { status: "active" },
          }),
        catch: (e) =>
          new ValidationError({ message: `Failed to update thread: ${e}` }),
      });

      return { thread, session };
    });
  }

  /**
   * Ensure an active in-memory session exists for the thread.
   * If the session was lost (e.g. server restart, manual stop), re-create it
   * from the thread's DB config.
   */
  ensureSession(
    threadId: ThreadId,
    opts?: EnsureSessionOpts,
  ): Effect.Effect<void, AdapterError> {
    const self = this;
    return Effect.gen(function* () {
      const thread = yield* Effect.tryPromise({
        try: () => prisma.thread.findUnique({ where: { id: threadId as string } }),
        catch: (e) =>
          new ValidationError({ message: `Failed to find thread: ${e}` }),
      });

      if (!thread) {
        return yield* Effect.fail(new SessionNotFoundError({ threadId }));
      }

      const adapter = yield* self.registry.get(thread.provider as ProviderKind);

      // Already has an active in-memory session — nothing to do
      if (adapter.hasSession(threadId)) return;

      console.log(`[provider] Restarting session for thread ${threadId}`);

      // Try to find a resume cursor from the last active session
      const lastSession = yield* Effect.tryPromise({
        try: () =>
          prisma.threadSession.findFirst({
            where: { threadId: threadId as string },
            orderBy: { startedAt: "desc" },
            select: { resumeCursor: true },
          }),
        catch: () => new ValidationError({ message: "Failed to find last session" }),
      }).pipe(Effect.catchAll(() => Effect.succeed(null)));

      const resumeCursor = (lastSession as any)?.resumeCursor ?? undefined;
      if (resumeCursor) {
        console.log(`[provider] Resuming session ${resumeCursor} for thread ${threadId}`);
      }

      yield* adapter.startSession({
        threadId,
        provider: thread.provider as ProviderKind,
        model: thread.model ?? undefined,
        runtimeMode: (thread.runtimeMode as "approval-required" | "full-access") ?? "approval-required",
        workspacePath: thread.workspacePath ?? "/workspace",
        useSubscription: opts?.useSubscription ?? false,
        apiKey: opts?.apiKey,
        githubToken: opts?.githubToken,
        repo: thread.repo ?? undefined,
        branch: thread.branch ?? undefined,
        resumeCursor,
      });

      // Update DB status
      yield* Effect.tryPromise({
        try: () =>
          prisma.thread.update({
            where: { id: threadId as string },
            data: { status: "active" },
          }),
        catch: (e) =>
          new ValidationError({ message: `Failed to update thread: ${e}` }),
      });

      yield* Effect.tryPromise({
        try: () =>
          prisma.threadSession.create({
            data: {
              threadId: threadId as string,
              provider: thread.provider,
              model: thread.model,
              status: "active",
            },
          }),
        catch: () => new ValidationError({ message: "session record" }),
      }).pipe(Effect.catchAll(() => Effect.void));
    });
  }

  sendTurn(input: SendTurnInput): Effect.Effect<TurnStartResult, AdapterError> {
    const self = this;
    return Effect.gen(function* () {
      const thread = yield* Effect.tryPromise({
        try: () => prisma.thread.findUnique({ where: { id: input.threadId as string } }),
        catch: (e) =>
          new ValidationError({ message: `Failed to find thread: ${e}` }),
      });

      if (!thread) {
        return yield* Effect.fail(
          new SessionNotFoundError({ threadId: input.threadId })
        );
      }

      const adapter = yield* self.registry.get(thread.provider as ProviderKind);

      const turnId = randomUUID();
      yield* Effect.tryPromise({
        try: () =>
          prisma.threadTurn.create({
            data: {
              threadId: thread.id,
              turnId,
              role: "user",
              content: input.text,
              status: "completed",
              completedAt: new Date(),
            },
          }),
        catch: (e) =>
          new ValidationError({ message: `Failed to record user turn: ${e}` }),
      });

      const result = yield* adapter.sendTurn(input);

      yield* Effect.tryPromise({
        try: () =>
          prisma.threadTurn.create({
            data: {
              threadId: thread.id,
              turnId: result.turnId,
              role: "assistant",
              status: "running",
            },
          }),
        catch: (e) =>
          new ValidationError({ message: `Failed to record assistant turn: ${e}` }),
      });

      return result;
    });
  }

  respondToRequest(
    threadId: ThreadId,
    requestId: string,
    decision: ApprovalDecision
  ): Effect.Effect<void, AdapterError> {
    const self = this;
    return Effect.gen(function* () {
      const thread = yield* Effect.tryPromise({
        try: () => prisma.thread.findUnique({ where: { id: threadId as string } }),
        catch: (e) =>
          new ValidationError({ message: `Failed to find thread: ${e}` }),
      });

      if (!thread) {
        return yield* Effect.fail(new SessionNotFoundError({ threadId }));
      }

      const adapter = yield* self.registry.get(thread.provider as ProviderKind);
      yield* adapter.respondToRequest(threadId, requestId, decision);
    });
  }

  stopThread(threadId: ThreadId): Effect.Effect<void, AdapterError> {
    const self = this;
    return Effect.gen(function* () {
      const thread = yield* Effect.tryPromise({
        try: () => prisma.thread.findUnique({ where: { id: threadId as string } }),
        catch: (e) =>
          new ValidationError({ message: `Failed to find thread: ${e}` }),
      });

      if (!thread) {
        return yield* Effect.fail(new SessionNotFoundError({ threadId }));
      }

      // Try to stop the adapter session, but don't fail if it's already gone
      // (e.g. server restarted, process died). The DB cleanup below is what matters.
      const adapter = yield* self.registry.get(thread.provider as ProviderKind);
      yield* adapter.stopSession(threadId).pipe(
        Effect.catchAll(() => Effect.void),
      );

      yield* Effect.tryPromise({
        try: () =>
          prisma.thread.update({
            where: { id: threadId as string },
            data: { status: "idle" },
          }),
        catch: (e) =>
          new ValidationError({ message: `Failed to update thread: ${e}` }),
      });

      yield* Effect.tryPromise({
        try: () =>
          prisma.threadSession.updateMany({
            where: { threadId: threadId as string, status: "active" },
            data: { status: "closed", endedAt: new Date() },
          }),
        catch: (e) =>
          new ValidationError({ message: `Failed to close sessions: ${e}` }),
      });
    });
  }

  interruptTurn(threadId: ThreadId): Effect.Effect<void, AdapterError> {
    const self = this;
    return Effect.gen(function* () {
      const thread = yield* Effect.tryPromise({
        try: () => prisma.thread.findUnique({ where: { id: threadId as string } }),
        catch: (e) =>
          new ValidationError({ message: `Failed to find thread: ${e}` }),
      });

      if (!thread) {
        return yield* Effect.fail(new SessionNotFoundError({ threadId }));
      }

      const adapter = yield* self.registry.get(thread.provider as ProviderKind);
      yield* adapter.interruptTurn(threadId).pipe(
        Effect.catchAll(() => Effect.void),
      );
    });
  }

  persistEvent(envelope: ProviderEventEnvelope): Effect.Effect<void, AdapterError> {
    const self = this;
    return Effect.gen(function* () {
      // Write the raw event
      yield* Effect.tryPromise({
        try: () =>
          prisma.threadEvent.create({
            data: {
              threadId: envelope.threadId as string,
              turnId: envelope.turnId as string | undefined,
              type: envelope.type,
              payload: envelope.payload as any,
              sequence: self.nextSequence(envelope.threadId as string),
              createdAt: envelope.createdAt,
            },
          }),
        catch: (e) =>
          new ValidationError({ message: `Failed to persist event: ${e}` }),
      });

      // Update turn record based on event type
      if (envelope.type === "turn.completed" && envelope.turnId) {
        yield* Effect.tryPromise({
          try: () =>
            prisma.threadTurn.updateMany({
              where: {
                threadId: envelope.threadId as string,
                turnId: envelope.turnId as string,
                role: "assistant",
              },
              data: {
                status: "completed",
                completedAt: new Date(),
              },
            }),
          catch: () => new ValidationError({ message: "Failed to update turn status" }),
        }).pipe(Effect.catchAll(() => Effect.void));
      }

      // Persist cost and usage data from session.configured (SDK result)
      if (envelope.type === "session.configured" && envelope.turnId) {
        const p = envelope.payload as { totalCostUsd?: number; usage?: any; numTurns?: number };
        if (p.totalCostUsd != null || p.usage) {
          yield* Effect.tryPromise({
            try: () =>
              prisma.threadTurn.updateMany({
                where: {
                  threadId: envelope.threadId as string,
                  turnId: envelope.turnId as string,
                  role: "assistant",
                },
                data: {
                  tokenUsage: {
                    ...(p.usage ?? {}),
                    totalCostUsd: p.totalCostUsd,
                    numTurns: p.numTurns,
                  },
                },
              }),
            catch: () => new ValidationError({ message: "Failed to persist cost data" }),
          }).pipe(Effect.catchAll(() => Effect.void));
        }
      }

      // Accumulate assistant text content
      if (
        envelope.type === "content.delta" &&
        envelope.turnId
      ) {
        const p = envelope.payload as { kind?: string; delta?: string };
        if (p.kind !== "text" || !p.delta) return;
        const delta = p.delta;
        const threadId = envelope.threadId as string;
        const turnId = envelope.turnId as string;
        yield* Effect.tryPromise({
          try: async () => {
            // Append text to the assistant turn's content field
            const turn = await prisma.threadTurn.findFirst({
              where: { threadId, turnId, role: "assistant" },
              select: { id: true, content: true },
            });
            if (turn) {
              await prisma.threadTurn.update({
                where: { id: turn.id },
                data: { content: (turn.content ?? "") + delta },
              });
            }
          },
          catch: () => new ValidationError({ message: "Failed to append turn content" }),
        }).pipe(Effect.catchAll(() => Effect.void));
      }
    });
  }

  mergedEventStream(): Stream.Stream<ProviderEventEnvelope, AdapterError> {
    const providers = this.registry.list();
    const streams = providers
      .map((p) => this.registry.getSync(p)?.streamEvents)
      .filter((s): s is Stream.Stream<ProviderEventEnvelope, AdapterError> => s != null);

    if (streams.length === 0) return Stream.empty;
    if (streams.length === 1) return streams[0];
    return streams.reduce((acc, s) => Stream.merge(acc, s));
  }
}
