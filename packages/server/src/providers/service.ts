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

export class ProviderService {
  constructor(private registry: ProviderAdapterRegistry) {}

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

      const adapter = yield* self.registry.get(thread.provider as ProviderKind);
      yield* adapter.stopSession(threadId);

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
      yield* adapter.interruptTurn(threadId);
    });
  }

  persistEvent(envelope: ProviderEventEnvelope): Effect.Effect<void, AdapterError> {
    return Effect.tryPromise({
      try: () =>
        prisma.threadEvent.create({
          data: {
            threadId: envelope.threadId as string,
            turnId: envelope.turnId as string | undefined,
            type: envelope.type,
            payload: envelope.payload as any,
            sequence: 0,
            createdAt: envelope.createdAt,
          },
        }),
      catch: (e) =>
        new ValidationError({ message: `Failed to persist event: ${e}` }),
    }).pipe(Effect.asVoid);
  }

  mergedEventStream(): Stream.Stream<ProviderEventEnvelope, AdapterError> {
    const providers = this.registry.list();
    if (providers.length === 0) return Stream.empty;

    const streams = providers.map((p) => {
      const adapter = this.registry.capabilities(p)
        ? Effect.runSync(this.registry.get(p))
        : null;
      return adapter?.streamEvents;
    }).filter((s): s is Stream.Stream<ProviderEventEnvelope, AdapterError> => s != null);

    if (streams.length === 0) return Stream.empty;
    if (streams.length === 1) return streams[0];
    return Stream.merge(streams[0], streams[1]);
  }
}
