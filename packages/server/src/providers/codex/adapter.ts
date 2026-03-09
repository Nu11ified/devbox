import { Effect, Stream } from "effect";
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
import type { ThreadId, AdapterError } from "../types.js";
import { ValidationError } from "../types.js";

export class CodexAdapter implements ProviderAdapterShape {
  readonly provider = "codex" as const;
  readonly capabilities: ProviderCapabilities = {
    sessionModelSwitch: "unsupported",
    supportsApprovals: false,
    supportsPlanMode: false,
    supportsResume: false,
  };

  hasSession(_threadId: import("../types.js").ThreadId): boolean {
    return false;
  }

  startSession(_input: SessionStartInput): Effect.Effect<ProviderSession, AdapterError> {
    return Effect.fail(
      new ValidationError({ message: "Codex adapter not yet implemented" })
    );
  }

  stopSession(_threadId: ThreadId): Effect.Effect<void, AdapterError> {
    return Effect.void;
  }

  stopAll(): Effect.Effect<void, AdapterError> {
    return Effect.void;
  }

  sendTurn(_input: SendTurnInput): Effect.Effect<TurnStartResult, AdapterError> {
    return Effect.fail(
      new ValidationError({ message: "Codex adapter not yet implemented" })
    );
  }

  interruptTurn(_threadId: ThreadId): Effect.Effect<void, AdapterError> {
    return Effect.void;
  }

  respondToRequest(
    _threadId: ThreadId,
    _requestId: string,
    _decision: ApprovalDecision
  ): Effect.Effect<void, AdapterError> {
    return Effect.void;
  }

  readThread(threadId: ThreadId): Effect.Effect<ThreadSnapshot, AdapterError> {
    return Effect.succeed({ threadId, events: [] });
  }

  rollbackThread(threadId: ThreadId, _numTurns: number): Effect.Effect<ThreadSnapshot, AdapterError> {
    return Effect.succeed({ threadId, events: [] });
  }

  readonly streamEvents: Stream.Stream<ProviderEventEnvelope, AdapterError> = Stream.empty;
}
