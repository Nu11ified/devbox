import { Schema } from "@effect/schema";
import { Data } from "effect";

// Provider Kind
export const ProviderKind = Schema.Literal("claudeCode", "codex");
export type ProviderKind = typeof ProviderKind.Type;

// Branded IDs
export type ThreadId = string & { readonly _tag: "ThreadId" };
export type TurnId = string & { readonly _tag: "TurnId" };
export type EventId = string & { readonly _tag: "EventId" };

export const ThreadId = (id: string): ThreadId => id as ThreadId;
export const TurnId = (id: string): TurnId => id as TurnId;
export const EventId = (id: string): EventId => id as EventId;

// Runtime Mode
export type RuntimeMode = "approval-required" | "full-access";

// Error Types
export class SessionNotFoundError extends Data.TaggedError("SessionNotFoundError")<{
  readonly threadId: ThreadId;
}> {}

export class SessionClosedError extends Data.TaggedError("SessionClosedError")<{
  readonly threadId: ThreadId;
}> {}

export class ProcessError extends Data.TaggedError("ProcessError")<{
  readonly threadId: ThreadId;
  readonly message: string;
  readonly recoverable: boolean;
}> {}

export class RequestError extends Data.TaggedError("RequestError")<{
  readonly threadId: ThreadId;
  readonly message: string;
  readonly statusCode?: number;
  readonly retryAfterMs?: number;
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string;
  readonly field?: string;
}> {}

export type AdapterError =
  | SessionNotFoundError
  | SessionClosedError
  | ProcessError
  | RequestError
  | ValidationError;
