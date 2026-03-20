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
  supportsSubagents?: boolean;
  supportsFileCheckpointing?: boolean;
  supportsCustomTools?: boolean;
  supportsTodoTracking?: boolean;
}

export interface SessionStartInput {
  threadId: ThreadId;
  provider: ProviderKind;
  model?: string;
  runtimeMode: RuntimeMode;
  workspacePath: string;
  useSubscription: boolean;
  apiKey?: string;
  /** OAuth credential files to inject (e.g. ~/.claude/ contents) */
  oauthFiles?: Record<string, Buffer>;
  githubToken?: string;
  resumeCursor?: unknown;
  repo?: string;
  branch?: string;
  userId?: string;
  projectId?: string;
}

export type EffortLevel = "low" | "medium" | "high" | "max";

export interface SendTurnInput {
  threadId: ThreadId;
  text: string;
  attachments?: Array<{ type: "file"; path: string }>;
  model?: string;
  effort?: EffortLevel;
  /** Fork the session to create a branch from the current conversation */
  forkSession?: boolean;
  /** Continue from the most recent session (alternative to resume cursor) */
  continueSession?: boolean;
  /** Request structured JSON output conforming to a schema */
  outputFormat?: {
    type: "json_schema";
    schema: Record<string, unknown>;
  };
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
  | { type: "allow"; reason?: string }
  | { type: "deny"; reason?: string }
  | { type: "allow_session" };

export interface ThreadSnapshot {
  threadId: ThreadId;
  events: ProviderEventEnvelope[];
}

export interface ProviderAdapterShape {
  readonly provider: ProviderKind;
  readonly capabilities: ProviderCapabilities;

  /** Check if an active in-memory session exists for this thread. */
  hasSession(threadId: ThreadId): boolean;

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
