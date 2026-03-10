import type { ProviderKind, ThreadId, TurnId, EventId } from "./types.js";

// Event Payloads
export interface SessionStartedPayload {
  sessionId: string;
  model?: string;
  runtimeMode: "approval-required" | "full-access";
}

export interface SessionConfiguredPayload {
  model: string;
  tools: string[];
}

export interface SessionExitedPayload {
  reason: "completed" | "error" | "stopped" | "crashed";
  exitCode?: number;
}

export interface TurnStartedPayload {
  turnId: TurnId;
}

export interface TurnCompletedPayload {
  turnId: TurnId;
  tokenUsage?: { inputTokens: number; outputTokens: number };
}

export interface TurnPlanUpdatedPayload {
  turnId: TurnId;
  plan: string;
}

export interface ContentDeltaPayload {
  turnId: TurnId;
  kind: "text" | "reasoning" | "plan";
  delta: string;
}

export type ToolCategory =
  | "command_execution"
  | "file_change"
  | "file_read"
  | "mcp_tool_call"
  | "dynamic_tool_call"
  | "todo_tracking"
  | "subagent";

export interface ItemStartedPayload {
  turnId: TurnId;
  itemId: string;
  toolName: string;
  toolCategory: ToolCategory;
  input: Record<string, unknown>;
}

export interface ItemCompletedPayload {
  turnId: TurnId;
  itemId: string;
  toolName: string;
  output?: unknown;
  exitCode?: number;
  error?: string;
}

export interface RequestOpenedPayload {
  turnId: TurnId;
  requestId: string;
  toolName: string;
  toolCategory: ToolCategory;
  input: Record<string, unknown>;
  description?: string;
}

export interface RequestResolvedPayload {
  turnId: TurnId;
  requestId: string;
  decision: "allow" | "deny" | "allow_session";
}

export interface RuntimeErrorPayload {
  message: string;
  code?: string;
  recoverable: boolean;
}

export interface RuntimeWarningPayload {
  message: string;
}

export interface DiffLine {
  type: "add" | "remove" | "context";
  content: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  status: "added" | "modified" | "deleted";
  hunks: DiffHunk[];
}

export interface DiffUpdatedPayload {
  turnId: TurnId;
  diff: string;
  files: DiffFile[];
}

export interface TodoUpdatedPayload {
  turnId: TurnId;
  todos: TodoItem[];
}

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface CheckpointCreatedPayload {
  turnId: TurnId;
  checkpointId: string;
}

export interface AskUserPayload {
  turnId: TurnId;
  requestId: string;
  question: string;
  options: Array<{ label: string; value: string }>;
}

// Discriminated Union
export type ProviderRuntimeEvent =
  | { type: "session.started"; payload: SessionStartedPayload }
  | { type: "session.configured"; payload: SessionConfiguredPayload }
  | { type: "session.exited"; payload: SessionExitedPayload }
  | { type: "turn.started"; payload: TurnStartedPayload }
  | { type: "turn.completed"; payload: TurnCompletedPayload }
  | { type: "turn.plan.updated"; payload: TurnPlanUpdatedPayload }
  | { type: "content.delta"; payload: ContentDeltaPayload }
  | { type: "item.started"; payload: ItemStartedPayload }
  | { type: "item.completed"; payload: ItemCompletedPayload }
  | { type: "request.opened"; payload: RequestOpenedPayload }
  | { type: "request.resolved"; payload: RequestResolvedPayload }
  | { type: "runtime.error"; payload: RuntimeErrorPayload }
  | { type: "runtime.warning"; payload: RuntimeWarningPayload }
  | { type: "diff.updated"; payload: DiffUpdatedPayload }
  | { type: "todo.updated"; payload: TodoUpdatedPayload }
  | { type: "checkpoint.created"; payload: CheckpointCreatedPayload }
  | { type: "ask_user"; payload: AskUserPayload };

// Envelope wrapping each event with metadata
export interface ProviderEventEnvelope {
  eventId: EventId;
  type: ProviderRuntimeEvent["type"];
  provider: ProviderKind;
  threadId: ThreadId;
  turnId?: TurnId;
  payload: ProviderRuntimeEvent["payload"];
  createdAt: Date;
  raw?: unknown;
}
