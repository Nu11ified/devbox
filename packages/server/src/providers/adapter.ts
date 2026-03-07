import { Effect, Stream } from "effect";
import type {
  ProviderKind,
  ThreadId,
  AdapterError,
  RuntimeMode,
} from "./types.js";
import type { ProviderRuntimeEvent, ProviderEventEnvelope } from "./events.js";

export interface ProviderCapabilities {
  sessionModelSwitch: "in-session" | "restart-session" | "unsupported";
  supportsApprovals: boolean;
  supportsPlanMode: boolean;
  supportsResume: boolean;
}

export interface SessionStartInput {
  threadId: ThreadId;
  provider: ProviderKind;
  model?: string;
  runtimeMode: RuntimeMode;
  workspacePath: string;
  useSubscription: boolean;
  apiKey?: string;
  githubToken?: string;
  resumeCursor?: unknown;
  repo?: string;
  branch?: string;
}

export interface SendTurnInput {
  threadId: ThreadId;
  text: string;
  attachments?: Array<{ type: "file"; path: string }>;
  model?: string;
}

export interface ProviderSession {
  threadId: ThreadId;
  provider: ProviderKind;
  sessionId: string;
  model: string;
  runtimeMode: RuntimeMode;
  resumeCursor?: unknown;
}

export interface TurnStartResult {
  turnId: string;
}

export type ApprovalDecision =
  | { type: "allow" }
  | { type: "deny"; reason?: string }
  | { type: "allow_session" };

export interface ThreadSnapshot {
  threadId: ThreadId;
  events: ProviderEventEnvelope[];
}

export interface ProviderAdapterShape {
  readonly provider: ProviderKind;
  readonly capabilities: ProviderCapabilities;

  startSession(input: SessionStartInput): Effect.Effect<ProviderSession, AdapterError>;
  stopSession(threadId: ThreadId): Effect.Effect<void, AdapterError>;
  stopAll(): Effect.Effect<void, AdapterError>;

  sendTurn(input: SendTurnInput): Effect.Effect<TurnStartResult, AdapterError>;
  interruptTurn(threadId: ThreadId): Effect.Effect<void, AdapterError>;

  respondToRequest(
    threadId: ThreadId,
    requestId: string,
    decision: ApprovalDecision
  ): Effect.Effect<void, AdapterError>;

  readThread(threadId: ThreadId): Effect.Effect<ThreadSnapshot, AdapterError>;
  rollbackThread(
    threadId: ThreadId,
    numTurns: number
  ): Effect.Effect<ThreadSnapshot, AdapterError>;

  readonly streamEvents: Stream.Stream<ProviderEventEnvelope, AdapterError>;
}
