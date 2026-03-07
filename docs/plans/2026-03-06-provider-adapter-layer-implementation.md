# Provider Adapter Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the entire agent execution layer with an Effect-TS provider adapter system that supports interactive sessions (human-in-the-loop with approvals) and autonomous dispatch, unified behind a single adapter interface.

**Architecture:** Every agent provider implements `ProviderAdapterShape`. The `ProviderService` routes turns to the correct adapter. The orchestration engine manages thread lifecycle. A bidirectional WebSocket transports events and commands between the UI and adapters. The thread UI renders a timeline of messages, tool calls, approval cards, and diffs.

**Tech Stack:** Effect-TS (`effect`, `@effect/schema`), `@anthropic-ai/claude-agent-sdk`, Prisma (new Thread/ThreadSession/ThreadTurn/ThreadEvent models), WebSocket (existing `ws`), React (existing Next.js UI), Tailwind CSS.

**Reference:** Design doc at `docs/plans/2026-03-06-provider-adapter-layer-design.md`

---

## Phase 1: Foundation

### Task 1: Install Effect-TS Dependencies

**Files:**
- Modify: `packages/server/package.json`

**Step 1: Add effect and @effect/schema**

```bash
cd /data/github/devbox
bun add --filter @patchwork/server effect @effect/schema
```

**Step 2: Verify installation**

```bash
cd packages/server && bun run tsc --noEmit --lib es2022 -e "import { Effect } from 'effect'"
```

If that fails, just verify `effect` is in `node_modules`:

```bash
ls node_modules/effect/package.json
```

**Step 3: Commit**

```bash
git add packages/server/package.json bun.lockb
git commit -m "feat: add effect-ts dependencies for provider adapter layer"
```

---

### Task 2: Define Provider Kind and Error Types

**Files:**
- Create: `packages/server/src/providers/types.ts`

**Step 1: Create the types file**

```typescript
// packages/server/src/providers/types.ts
import { Schema } from "@effect/schema";
import { Data } from "effect";

// ── Provider Kind ──────────────────────────────────────────────────

export const ProviderKind = Schema.Literal("claudeCode", "codex");
export type ProviderKind = typeof ProviderKind.Type;

// ── Branded IDs ────────────────────────────────────────────────────

export type ThreadId = string & { readonly _tag: "ThreadId" };
export type TurnId = string & { readonly _tag: "TurnId" };
export type EventId = string & { readonly _tag: "EventId" };

export const ThreadId = (id: string): ThreadId => id as ThreadId;
export const TurnId = (id: string): TurnId => id as TurnId;
export const EventId = (id: string): EventId => id as EventId;

// ── Runtime Mode ───────────────────────────────────────────────────

export type RuntimeMode = "approval-required" | "full-access";

// ── Error Types ────────────────────────────────────────────────────

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
```

**Step 2: Verify it compiles**

```bash
cd /data/github/devbox && bun run --filter @patchwork/server build
```

**Step 3: Commit**

```bash
git add packages/server/src/providers/types.ts
git commit -m "feat: add provider kind and error types"
```

---

### Task 3: Define Canonical Event Model

**Files:**
- Create: `packages/server/src/providers/events.ts`

**Step 1: Create the events file**

```typescript
// packages/server/src/providers/events.ts
import type { ProviderKind, ThreadId, TurnId, EventId } from "./types.js";

// ── Event Payloads ─────────────────────────────────────────────────

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
  | "dynamic_tool_call";

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

// ── Discriminated Union ────────────────────────────────────────────

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
  | { type: "runtime.warning"; payload: RuntimeWarningPayload };

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
```

**Step 2: Verify it compiles**

```bash
cd /data/github/devbox && bun run --filter @patchwork/server build
```

**Step 3: Commit**

```bash
git add packages/server/src/providers/events.ts
git commit -m "feat: add canonical provider event model"
```

---

### Task 4: Define Provider Adapter Interface

**Files:**
- Create: `packages/server/src/providers/adapter.ts`

**Step 1: Create the adapter interface**

```typescript
// packages/server/src/providers/adapter.ts
import { Effect, Stream } from "effect";
import type {
  ProviderKind,
  ThreadId,
  AdapterError,
  RuntimeMode,
} from "./types.js";
import type { ProviderRuntimeEvent, ProviderEventEnvelope } from "./events.js";

// ── Capability Declaration ─────────────────────────────────────────

export interface ProviderCapabilities {
  sessionModelSwitch: "in-session" | "restart-session" | "unsupported";
  supportsApprovals: boolean;
  supportsPlanMode: boolean;
  supportsResume: boolean;
}

// ── Session Start Input ────────────────────────────────────────────

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
}

// ── Send Turn Input ────────────────────────────────────────────────

export interface SendTurnInput {
  threadId: ThreadId;
  text: string;
  attachments?: Array<{ type: "file"; path: string }>;
  model?: string;
}

// ── Provider Session ───────────────────────────────────────────────

export interface ProviderSession {
  threadId: ThreadId;
  provider: ProviderKind;
  sessionId: string;
  model: string;
  runtimeMode: RuntimeMode;
  resumeCursor?: unknown;
}

// ── Turn Start Result ──────────────────────────────────────────────

export interface TurnStartResult {
  turnId: string;
}

// ── Approval Decision ──────────────────────────────────────────────

export type ApprovalDecision =
  | { type: "allow" }
  | { type: "deny"; reason?: string }
  | { type: "allow_session" };

// ── Thread Snapshot ────────────────────────────────────────────────

export interface ThreadSnapshot {
  threadId: ThreadId;
  events: ProviderEventEnvelope[];
}

// ── Adapter Interface ──────────────────────────────────────────────

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
```

**Step 2: Verify it compiles**

```bash
cd /data/github/devbox && bun run --filter @patchwork/server build
```

**Step 3: Commit**

```bash
git add packages/server/src/providers/adapter.ts
git commit -m "feat: add ProviderAdapterShape interface"
```

---

### Task 5: Create Provider Barrel Export

**Files:**
- Create: `packages/server/src/providers/index.ts`

**Step 1: Create the barrel file**

```typescript
// packages/server/src/providers/index.ts
export * from "./types.js";
export * from "./events.js";
export * from "./adapter.js";
```

**Step 2: Verify it compiles**

```bash
cd /data/github/devbox && bun run --filter @patchwork/server build
```

**Step 3: Commit**

```bash
git add packages/server/src/providers/index.ts
git commit -m "feat: add provider module barrel export"
```

---

### Task 6: Add Thread Models to Prisma Schema

**Files:**
- Modify: `packages/server/prisma/schema.prisma`

**Step 1: Add Thread, ThreadSession, ThreadTurn, ThreadEvent models**

Append after the `UserSettings` model (before the closing of the file):

```prisma
// ─── Thread system (provider adapter layer) ───────────────────────

model Thread {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  title       String
  provider    String
  model       String?
  runtimeMode String   @default("approval-required") @map("runtime_mode")
  status      String   @default("idle")
  issueId     String?  @unique @map("issue_id") @db.Uuid
  userId      String?  @map("user_id")
  workspacePath String? @map("workspace_path")
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  issue    Issue?          @relation(fields: [issueId], references: [id])
  user     User?           @relation(fields: [userId], references: [id])
  sessions ThreadSession[]
  turns    ThreadTurn[]
  events   ThreadEvent[]

  @@index([status])
  @@index([userId])
  @@map("threads")
}

model ThreadSession {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  threadId     String    @map("thread_id") @db.Uuid
  provider     String
  model        String?
  resumeCursor Json?     @map("resume_cursor")
  status       String    @default("starting")
  startedAt    DateTime  @default(now()) @map("started_at") @db.Timestamptz
  endedAt      DateTime? @map("ended_at") @db.Timestamptz

  thread Thread @relation(fields: [threadId], references: [id], onDelete: Cascade)

  @@index([threadId])
  @@map("thread_sessions")
}

model ThreadTurn {
  id          String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  threadId    String    @map("thread_id") @db.Uuid
  turnId      String    @map("turn_id")
  role        String    @default("user")
  content     String?
  status      String    @default("running")
  startedAt   DateTime  @default(now()) @map("started_at") @db.Timestamptz
  completedAt DateTime? @map("completed_at") @db.Timestamptz
  tokenUsage  Json?     @map("token_usage")

  thread Thread @relation(fields: [threadId], references: [id], onDelete: Cascade)

  @@index([threadId])
  @@map("thread_turns")
}

model ThreadEvent {
  id        String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  threadId  String   @map("thread_id") @db.Uuid
  turnId    String?  @map("turn_id")
  type      String
  payload   Json
  sequence  Int
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  thread Thread @relation(fields: [threadId], references: [id], onDelete: Cascade)

  @@index([threadId, sequence])
  @@map("thread_events")
}
```

Also add the reverse relation on existing models. Add to `Issue` model:

```prisma
  thread   Thread?
```

Add to `User` model:

```prisma
  threads  Thread[]
```

**Step 2: Generate Prisma client**

```bash
cd /data/github/devbox/packages/server && bun run prisma generate
```

**Step 3: Create migration**

```bash
cd /data/github/devbox/packages/server && bun run prisma migrate dev --name add-thread-tables
```

**Step 4: Verify build**

```bash
cd /data/github/devbox && bun run --filter @patchwork/server build
```

**Step 5: Commit**

```bash
git add packages/server/prisma/
git commit -m "feat: add Thread, ThreadSession, ThreadTurn, ThreadEvent tables"
```

---

## Phase 2: Claude Code Adapter

### Task 7: Install Claude Agent SDK

**Files:**
- Modify: `packages/server/package.json`

**Step 1: Install the SDK**

```bash
cd /data/github/devbox
bun add --filter @patchwork/server @anthropic-ai/claude-code
```

Note: The package name may be `@anthropic-ai/claude-code` or `@anthropic-ai/claude-agent-sdk`. Check npm registry at install time. If the first fails, try:

```bash
bun add --filter @patchwork/server @anthropic-ai/claude-agent-sdk
```

**Step 2: Commit**

```bash
git add packages/server/package.json bun.lockb
git commit -m "feat: add claude agent SDK dependency"
```

---

### Task 8: Create Tool Classification Helper

**Files:**
- Create: `packages/server/src/providers/claude-code/classify-tool.ts`

**Step 1: Create the classifier**

```typescript
// packages/server/src/providers/claude-code/classify-tool.ts
import type { ToolCategory } from "../events.js";

const COMMAND_TOOLS = new Set(["bash", "shell", "Bash", "computer"]);
const FILE_CHANGE_TOOLS = new Set(["edit", "write", "Write", "Edit", "NotebookEdit"]);
const FILE_READ_TOOLS = new Set(["read", "Read", "Glob", "Grep", "LS"]);

export function classifyTool(toolName: string): ToolCategory {
  if (COMMAND_TOOLS.has(toolName)) return "command_execution";
  if (FILE_CHANGE_TOOLS.has(toolName)) return "file_change";
  if (FILE_READ_TOOLS.has(toolName)) return "file_read";
  if (toolName.startsWith("mcp__") || toolName.startsWith("mcp_")) return "mcp_tool_call";
  return "dynamic_tool_call";
}
```

**Step 2: Verify build**

```bash
cd /data/github/devbox && bun run --filter @patchwork/server build
```

**Step 3: Commit**

```bash
git add packages/server/src/providers/claude-code/
git commit -m "feat: add tool classification helper for Claude Code"
```

---

### Task 9: Implement ClaudeCodeAdapter

**Files:**
- Create: `packages/server/src/providers/claude-code/adapter.ts`

This is the core adapter. It uses the Claude Agent SDK's `query()` method which returns an `AsyncIterable` of messages. The adapter maps each message to canonical `ProviderRuntimeEvent`s.

**Step 1: Create the adapter**

```typescript
// packages/server/src/providers/claude-code/adapter.ts
import { Effect, Stream, Queue, Deferred, Ref, pipe } from "effect";
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
  SessionClosedError,
  ProcessError,
} from "../types.js";
import type { AdapterError } from "../types.js";
import { classifyTool } from "./classify-tool.js";

// Pending approval request with a Deferred for async resolution
interface PendingRequest {
  requestId: string;
  deferred: Deferred.Deferred<ApprovalDecision, never>;
}

// Internal session state tracked per thread
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
  private sequenceCounters = new Map<string, number>();

  // SDK import — lazy-loaded to handle optional dependency
  private sdkModule: any = null;

  private async getSDK() {
    if (!this.sdkModule) {
      // Try both possible package names
      try {
        this.sdkModule = await import("@anthropic-ai/claude-code");
      } catch {
        this.sdkModule = await import("@anthropic-ai/claude-agent-sdk" as any);
      }
    }
    return this.sdkModule;
  }

  private nextSequence(threadId: string): number {
    const current = this.sequenceCounters.get(threadId) ?? 0;
    this.sequenceCounters.set(threadId, current + 1);
    return current;
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
    return Stream.unwrap(
      Effect.gen(function* () {
        // Lazily create the queue on first subscription
        const self = this as ClaudeCodeAdapter;
        if (!self.eventQueue) {
          self.eventQueue = yield* Queue.unbounded<ProviderEventEnvelope>();
        }
        return Stream.fromQueue(self.eventQueue);
      }.bind(this))
    );
  }

  startSession(input: SessionStartInput): Effect.Effect<ProviderSession, AdapterError> {
    return Effect.gen(function* () {
      const self = this as ClaudeCodeAdapter;
      const sessionId = randomUUID();

      const session: ProviderSession = {
        threadId: input.threadId,
        provider: "claudeCode",
        sessionId,
        model: input.model ?? "claude-sonnet-4-20250514",
        runtimeMode: input.runtimeMode,
        resumeCursor: input.resumeCursor,
      };

      const abortController = new AbortController();

      const state: SessionState = {
        session,
        abortController,
        pendingRequests: new Map(),
      };

      self.sessions.set(input.threadId as string, state);
      self.sequenceCounters.set(input.threadId as string, 0);

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
    }.bind(this));
  }

  stopSession(threadId: ThreadId): Effect.Effect<void, AdapterError> {
    return Effect.gen(function* () {
      const self = this as ClaudeCodeAdapter;
      const state = self.sessions.get(threadId as string);
      if (!state) {
        return yield* Effect.fail(new SessionNotFoundError({ threadId }));
      }

      state.abortController.abort();

      // Reject all pending approval requests
      for (const [, req] of state.pendingRequests) {
        yield* Deferred.succeed(req.deferred, { type: "deny" as const, reason: "Session stopped" });
      }

      self.sessions.delete(threadId as string);

      yield* Effect.tryPromise({
        try: () =>
          self.enqueue(
            self.makeEnvelope("session.exited", threadId, {
              reason: "stopped",
            })
          ),
        catch: (e) =>
          new ProcessError({
            threadId,
            message: `Failed to emit session.exited: ${e}`,
            recoverable: false,
          }),
      });
    }.bind(this));
  }

  stopAll(): Effect.Effect<void, AdapterError> {
    return Effect.gen(function* () {
      const self = this as ClaudeCodeAdapter;
      const threadIds = Array.from(self.sessions.keys());
      for (const id of threadIds) {
        yield* self.stopSession(ThreadId(id));
      }
    }.bind(this));
  }

  sendTurn(input: SendTurnInput): Effect.Effect<TurnStartResult, AdapterError> {
    return Effect.gen(function* () {
      const self = this as ClaudeCodeAdapter;
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

      // Fire off the SDK query in the background
      yield* Effect.tryPromise({
        try: () => self.runQuery(state, input, turnId),
        catch: (e) =>
          new ProcessError({
            threadId: input.threadId,
            message: `Failed to start query: ${e}`,
            recoverable: true,
          }),
      });

      return { turnId: turnId as string };
    }.bind(this));
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
        allowedTools: isFullAccess ? ["*"] : undefined,
      };

      if (state.session.resumeCursor) {
        options.resume = state.session.resumeCursor;
      }

      // canUseTool callback for approval-required mode
      if (!isFullAccess) {
        options.permissionMode = "default";
      }

      const result = sdk.query(options);

      for await (const message of result) {
        if (state.abortController.signal.aborted) break;

        const envelopes = this.mapSDKMessage(message, threadId, turnId);
        for (const env of envelopes) {
          await this.enqueue(env);
        }

        // Handle approval requests
        if (message.type === "tool_use" && !isFullAccess) {
          const requestId = randomUUID();
          const toolCategory = classifyTool(message.name ?? "unknown");

          await this.enqueue(
            this.makeEnvelope("request.opened", threadId, {
              turnId,
              requestId,
              toolName: message.name ?? "unknown",
              toolCategory,
              input: message.input ?? {},
              description: this.describeToolUse(message),
            }, turnId, message)
          );

          // Block until user responds via respondToRequest
          const deferred = Deferred.unsafeMake<ApprovalDecision, never>(randomUUID());
          state.pendingRequests.set(requestId, { requestId, deferred });

          const decision = await Effect.runPromise(Deferred.await(deferred));
          state.pendingRequests.delete(requestId);

          await this.enqueue(
            this.makeEnvelope("request.resolved", threadId, {
              turnId,
              requestId,
              decision: decision.type,
            }, turnId)
          );

          // If denied, the SDK message loop should handle it via the callback
        }
      }

      // Turn completed
      await this.enqueue(
        this.makeEnvelope("turn.completed", threadId, {
          turnId,
          tokenUsage: undefined, // SDK may provide this in result
        }, turnId)
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
            turnId,
            kind: "text",
            delta,
          }, turnId, message)
        );
      }
    } else if (message.type === "thinking" || message.type === "reasoning") {
      const delta = message.thinking ?? message.text ?? "";
      if (delta) {
        envelopes.push(
          this.makeEnvelope("content.delta", threadId, {
            turnId,
            kind: "reasoning",
            delta,
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

  private describeToolUse(message: any): string {
    const name = message.name ?? "unknown";
    const input = message.input ?? {};
    if (name === "Bash" || name === "bash") {
      return `Run command: ${input.command ?? ""}`;
    }
    if (name === "Edit" || name === "edit") {
      return `Edit file: ${input.file_path ?? input.path ?? ""}`;
    }
    if (name === "Write" || name === "write") {
      return `Write file: ${input.file_path ?? input.path ?? ""}`;
    }
    return `Use tool: ${name}`;
  }

  interruptTurn(threadId: ThreadId): Effect.Effect<void, AdapterError> {
    return Effect.gen(function* () {
      const self = this as ClaudeCodeAdapter;
      const state = self.sessions.get(threadId as string);
      if (!state) {
        return yield* Effect.fail(new SessionNotFoundError({ threadId }));
      }
      state.abortController.abort();
      // Create new abort controller for next turn
      state.abortController = new AbortController();
    }.bind(this));
  }

  respondToRequest(
    threadId: ThreadId,
    requestId: string,
    decision: ApprovalDecision
  ): Effect.Effect<void, AdapterError> {
    return Effect.gen(function* () {
      const self = this as ClaudeCodeAdapter;
      const state = self.sessions.get(threadId as string);
      if (!state) {
        return yield* Effect.fail(new SessionNotFoundError({ threadId }));
      }

      const pending = state.pendingRequests.get(requestId);
      if (!pending) {
        return; // Request may have already been resolved
      }

      yield* Deferred.succeed(pending.deferred, decision);
    }.bind(this));
  }

  readThread(threadId: ThreadId): Effect.Effect<ThreadSnapshot, AdapterError> {
    return Effect.gen(function* () {
      // Thread reading is delegated to the orchestration engine's DB queries
      // The adapter returns an empty snapshot — the engine fills in from DB
      return { threadId, events: [] };
    });
  }

  rollbackThread(
    threadId: ThreadId,
    _numTurns: number
  ): Effect.Effect<ThreadSnapshot, AdapterError> {
    return Effect.gen(function* () {
      // Rollback requires restarting the session with a resume cursor
      // pointing to an earlier state. For now, return empty snapshot.
      return { threadId, events: [] };
    });
  }
}
```

**Step 2: Create barrel export**

```typescript
// packages/server/src/providers/claude-code/index.ts
export { ClaudeCodeAdapter } from "./adapter.js";
export { classifyTool } from "./classify-tool.js";
```

**Step 3: Verify build**

```bash
cd /data/github/devbox && bun run --filter @patchwork/server build
```

Note: Build may warn about the SDK import if it's not yet installed. That's expected — the lazy import handles this at runtime.

**Step 4: Commit**

```bash
git add packages/server/src/providers/claude-code/
git commit -m "feat: implement ClaudeCodeAdapter with event mapping and approvals"
```

---

### Task 10: Create Provider Adapter Registry

**Files:**
- Create: `packages/server/src/providers/registry.ts`

**Step 1: Create the registry**

```typescript
// packages/server/src/providers/registry.ts
import { Effect } from "effect";
import type { ProviderAdapterShape } from "./adapter.js";
import type { ProviderKind, AdapterError } from "./types.js";
import { ValidationError } from "./types.js";

export class ProviderAdapterRegistry {
  private adapters = new Map<ProviderKind, ProviderAdapterShape>();

  register(adapter: ProviderAdapterShape): void {
    this.adapters.set(adapter.provider, adapter);
  }

  get(provider: ProviderKind): Effect.Effect<ProviderAdapterShape, AdapterError> {
    return Effect.gen(function* () {
      const adapter = this.adapters.get(provider);
      if (!adapter) {
        return yield* Effect.fail(
          new ValidationError({
            message: `No adapter registered for provider: ${provider}`,
            field: "provider",
          })
        );
      }
      return adapter;
    }.bind(this));
  }

  list(): ProviderKind[] {
    return Array.from(this.adapters.keys());
  }

  capabilities(provider: ProviderKind) {
    return this.adapters.get(provider)?.capabilities;
  }
}
```

**Step 2: Update barrel export**

Add to `packages/server/src/providers/index.ts`:

```typescript
export { ProviderAdapterRegistry } from "./registry.js";
export { ClaudeCodeAdapter } from "./claude-code/index.js";
```

**Step 3: Verify build**

```bash
cd /data/github/devbox && bun run --filter @patchwork/server build
```

**Step 4: Commit**

```bash
git add packages/server/src/providers/registry.ts packages/server/src/providers/index.ts
git commit -m "feat: add ProviderAdapterRegistry"
```

---

## Phase 3: Orchestration Engine

### Task 11: Create ProviderService

**Files:**
- Create: `packages/server/src/providers/service.ts`

The `ProviderService` is the central service that routes operations to the correct adapter, manages thread-to-provider bindings, and persists events.

**Step 1: Create the service**

```typescript
// packages/server/src/providers/service.ts
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
  TurnId,
  SessionNotFoundError,
  ValidationError,
} from "./types.js";
import type { ProviderKind, AdapterError } from "./types.js";

export class ProviderService {
  constructor(private registry: ProviderAdapterRegistry) {}

  /**
   * Create a new thread and start a provider session.
   */
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
    return Effect.gen(function* () {
      const adapter = yield* this.registry.get(input.provider);

      // Create thread in DB
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

      // Start provider session
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

      // Record session in DB
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

      // Update thread status
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
    }.bind(this));
  }

  /**
   * Send a user turn to the thread's provider.
   */
  sendTurn(input: SendTurnInput): Effect.Effect<TurnStartResult, AdapterError> {
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

      const adapter = yield* this.registry.get(thread.provider as ProviderKind);

      // Record user turn in DB
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

      // Send to adapter
      const result = yield* adapter.sendTurn(input);

      // Record assistant turn placeholder
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
    }.bind(this));
  }

  /**
   * Respond to an approval request.
   */
  respondToRequest(
    threadId: ThreadId,
    requestId: string,
    decision: ApprovalDecision
  ): Effect.Effect<void, AdapterError> {
    return Effect.gen(function* () {
      const thread = yield* Effect.tryPromise({
        try: () => prisma.thread.findUnique({ where: { id: threadId as string } }),
        catch: (e) =>
          new ValidationError({ message: `Failed to find thread: ${e}` }),
      });

      if (!thread) {
        return yield* Effect.fail(new SessionNotFoundError({ threadId }));
      }

      const adapter = yield* this.registry.get(thread.provider as ProviderKind);
      yield* adapter.respondToRequest(threadId, requestId, decision);
    }.bind(this));
  }

  /**
   * Stop a thread's session.
   */
  stopThread(threadId: ThreadId): Effect.Effect<void, AdapterError> {
    return Effect.gen(function* () {
      const thread = yield* Effect.tryPromise({
        try: () => prisma.thread.findUnique({ where: { id: threadId as string } }),
        catch: (e) =>
          new ValidationError({ message: `Failed to find thread: ${e}` }),
      });

      if (!thread) {
        return yield* Effect.fail(new SessionNotFoundError({ threadId }));
      }

      const adapter = yield* this.registry.get(thread.provider as ProviderKind);
      yield* adapter.stopSession(threadId);

      // Update thread status
      yield* Effect.tryPromise({
        try: () =>
          prisma.thread.update({
            where: { id: threadId as string },
            data: { status: "idle" },
          }),
        catch: (e) =>
          new ValidationError({ message: `Failed to update thread: ${e}` }),
      });

      // Close active sessions
      yield* Effect.tryPromise({
        try: () =>
          prisma.threadSession.updateMany({
            where: { threadId: threadId as string, status: "active" },
            data: { status: "closed", endedAt: new Date() },
          }),
        catch: (e) =>
          new ValidationError({ message: `Failed to close sessions: ${e}` }),
      });
    }.bind(this));
  }

  /**
   * Interrupt the current turn.
   */
  interruptTurn(threadId: ThreadId): Effect.Effect<void, AdapterError> {
    return Effect.gen(function* () {
      const thread = yield* Effect.tryPromise({
        try: () => prisma.thread.findUnique({ where: { id: threadId as string } }),
        catch: (e) =>
          new ValidationError({ message: `Failed to find thread: ${e}` }),
      });

      if (!thread) {
        return yield* Effect.fail(new SessionNotFoundError({ threadId }));
      }

      const adapter = yield* this.registry.get(thread.provider as ProviderKind);
      yield* adapter.interruptTurn(threadId);
    }.bind(this));
  }

  /**
   * Persist a provider event to the database.
   */
  persistEvent(envelope: ProviderEventEnvelope): Effect.Effect<void, AdapterError> {
    return Effect.tryPromise({
      try: () =>
        prisma.threadEvent.create({
          data: {
            threadId: envelope.threadId as string,
            turnId: envelope.turnId as string | undefined,
            type: envelope.type,
            payload: envelope.payload as any,
            sequence: 0, // Will be set by trigger or application logic
            createdAt: envelope.createdAt,
          },
        }),
      catch: (e) =>
        new ValidationError({ message: `Failed to persist event: ${e}` }),
    }).pipe(Effect.asVoid);
  }

  /**
   * Get merged event stream from all adapters.
   */
  mergedEventStream(): Stream.Stream<ProviderEventEnvelope, AdapterError> {
    const adapters = this.registry.list().map((p) =>
      Effect.runSync(this.registry.get(p))
    );
    if (adapters.length === 0) return Stream.empty;
    if (adapters.length === 1) return adapters[0].streamEvents;
    return Stream.merge(adapters[0].streamEvents, adapters[1].streamEvents);
  }
}
```

**Step 2: Update barrel export**

Add to `packages/server/src/providers/index.ts`:

```typescript
export { ProviderService } from "./service.js";
```

**Step 3: Verify build**

```bash
cd /data/github/devbox && bun run --filter @patchwork/server build
```

**Step 4: Commit**

```bash
git add packages/server/src/providers/service.ts packages/server/src/providers/index.ts
git commit -m "feat: add ProviderService for thread lifecycle management"
```

---

### Task 12: Create Thread API Router

**Files:**
- Create: `packages/server/src/api/threads.ts`

**Step 1: Create the router**

```typescript
// packages/server/src/api/threads.ts
import { Router } from "express";
import { Effect } from "effect";
import prisma from "../db/prisma.js";
import type { ProviderService } from "../providers/service.js";
import { ThreadId } from "../providers/types.js";
import type { ProviderKind } from "../providers/types.js";

export function threadsRouter(providerService: ProviderService): Router {
  const router = Router();

  // List threads for current user
  router.get("/", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      const threads = await prisma.thread.findMany({
        where: userId ? { userId } : {},
        orderBy: { updatedAt: "desc" },
        include: {
          _count: { select: { turns: true, events: true } },
        },
        take: 50,
      });
      res.json(threads);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get single thread with turns and recent events
  router.get("/:id", async (req, res) => {
    try {
      const thread = await prisma.thread.findUnique({
        where: { id: req.params.id },
        include: {
          turns: { orderBy: { startedAt: "asc" } },
          events: { orderBy: { sequence: "asc" }, take: 500 },
          sessions: { orderBy: { startedAt: "desc" }, take: 1 },
        },
      });
      if (!thread) return res.status(404).json({ error: "Thread not found" });
      res.json(thread);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create thread and start session
  router.post("/", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      const {
        title,
        provider,
        model,
        runtimeMode,
        workspacePath,
        useSubscription,
        issueId,
      } = req.body;

      if (!title || !provider || !workspacePath) {
        return res.status(400).json({
          error: "title, provider, and workspacePath are required",
        });
      }

      // Resolve subscription from user settings if not explicit
      let subscription = useSubscription ?? false;
      if (userId && !useSubscription) {
        const settings = await prisma.userSettings.findUnique({
          where: { userId },
        });
        if (provider === "claudeCode" && settings?.claudeSubscription) {
          subscription = true;
        }
      }

      // Get GitHub token for the user
      let githubToken: string | undefined;
      if (userId) {
        const account = await prisma.account.findFirst({
          where: { userId, providerId: "github" },
        });
        githubToken = account?.accessToken ?? undefined;
      }

      const result = await Effect.runPromise(
        providerService.createThread({
          title,
          provider: provider as ProviderKind,
          model,
          runtimeMode: runtimeMode ?? "approval-required",
          workspacePath,
          useSubscription: subscription,
          githubToken,
          userId,
          issueId,
        })
      );

      res.status(201).json(result.thread);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Send turn
  router.post("/:id/turns", async (req, res) => {
    try {
      const { text, model, attachments } = req.body;
      if (!text) return res.status(400).json({ error: "text is required" });

      const result = await Effect.runPromise(
        providerService.sendTurn({
          threadId: ThreadId(req.params.id),
          text,
          model,
          attachments,
        })
      );

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Respond to approval request
  router.post("/:id/approve", async (req, res) => {
    try {
      const { requestId, decision } = req.body;
      if (!requestId || !decision) {
        return res.status(400).json({ error: "requestId and decision required" });
      }

      await Effect.runPromise(
        providerService.respondToRequest(
          ThreadId(req.params.id),
          requestId,
          decision
        )
      );

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Interrupt current turn
  router.post("/:id/interrupt", async (req, res) => {
    try {
      await Effect.runPromise(
        providerService.interruptTurn(ThreadId(req.params.id))
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Stop thread session
  router.post("/:id/stop", async (req, res) => {
    try {
      await Effect.runPromise(
        providerService.stopThread(ThreadId(req.params.id))
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete thread
  router.delete("/:id", async (req, res) => {
    try {
      await prisma.thread.delete({ where: { id: req.params.id } });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
```

**Step 2: Verify build**

```bash
cd /data/github/devbox && bun run --filter @patchwork/server build
```

**Step 3: Commit**

```bash
git add packages/server/src/api/threads.ts
git commit -m "feat: add thread API router"
```

---

### Task 13: Wire Provider System into Server

**Files:**
- Modify: `packages/server/src/index.ts`

**Step 1: Initialize provider system and mount thread router**

Add imports and initialization to `packages/server/src/index.ts`:

```typescript
// Add these imports at the top
import { ProviderAdapterRegistry, ProviderService, ClaudeCodeAdapter } from "./providers/index.js";
import { threadsRouter } from "./api/threads.js";
```

Inside `createApp()`, before the router mounts, add:

```typescript
  // Provider adapter system
  const adapterRegistry = new ProviderAdapterRegistry();
  adapterRegistry.register(new ClaudeCodeAdapter());
  const providerService = new ProviderService(adapterRegistry);
```

Mount the threads router alongside the other routers:

```typescript
  app.use("/api/threads", threadsRouter(providerService));
```

**Step 2: Verify build**

```bash
cd /data/github/devbox && bun run --filter @patchwork/server build
```

**Step 3: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat: wire provider adapter system and threads router into server"
```

---

## Phase 4: WebSocket Transport

### Task 14: Create Thread WebSocket Handler

**Files:**
- Create: `packages/server/src/api/thread-ws.ts`

**Step 1: Create the WebSocket handler**

```typescript
// packages/server/src/api/thread-ws.ts
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { Effect, Stream } from "effect";
import type { ProviderService } from "../providers/service.js";
import { ThreadId } from "../providers/types.js";
import type { ProviderEventEnvelope } from "../providers/events.js";
import prisma from "../db/prisma.js";

interface ThreadConnection {
  ws: WebSocket;
  threadId: string;
}

export function setupThreadWebSocket(
  server: HttpServer,
  providerService: ProviderService
): void {
  const wss = new WebSocketServer({ server, path: "/ws/threads" });
  const connections = new Map<string, Set<ThreadConnection>>();

  // Start event stream consumer that fans out events to connected clients
  startEventFanOut(providerService, connections);

  wss.on("connection", async (ws, req) => {
    const url = new URL(req.url ?? "", `http://${req.headers.host}`);
    const threadId = url.searchParams.get("threadId");

    if (!threadId) {
      ws.close(4000, "threadId query parameter required");
      return;
    }

    // Validate thread exists
    const thread = await prisma.thread.findUnique({
      where: { id: threadId },
    });
    if (!thread) {
      ws.close(4004, "Thread not found");
      return;
    }

    // Register connection
    const conn: ThreadConnection = { ws, threadId };
    if (!connections.has(threadId)) {
      connections.set(threadId, new Set());
    }
    connections.get(threadId)!.add(conn);

    // Send current thread status
    ws.send(
      JSON.stringify({
        type: "thread.session.status",
        threadId,
        status: thread.status,
        provider: thread.provider,
        model: thread.model,
      })
    );

    // Handle incoming commands
    ws.on("message", async (raw) => {
      try {
        const message = JSON.parse(String(raw));
        await handleCommand(message, threadId, providerService, ws);
      } catch (err: any) {
        ws.send(
          JSON.stringify({
            type: "thread.error",
            error: err.message ?? "Invalid command",
          })
        );
      }
    });

    ws.on("close", () => {
      connections.get(threadId)?.delete(conn);
      if (connections.get(threadId)?.size === 0) {
        connections.delete(threadId);
      }
    });
  });
}

async function handleCommand(
  message: any,
  threadId: string,
  providerService: ProviderService,
  ws: WebSocket
): Promise<void> {
  const tid = ThreadId(threadId);

  switch (message.type) {
    case "thread.sendTurn": {
      const result = await Effect.runPromise(
        providerService.sendTurn({
          threadId: tid,
          text: message.text,
          model: message.model,
          attachments: message.attachments,
        })
      );
      ws.send(JSON.stringify({ type: "thread.turn.started", turnId: result.turnId }));
      break;
    }

    case "thread.interrupt": {
      await Effect.runPromise(providerService.interruptTurn(tid));
      ws.send(JSON.stringify({ type: "thread.turn.interrupted", threadId }));
      break;
    }

    case "thread.approval": {
      await Effect.runPromise(
        providerService.respondToRequest(tid, message.requestId, {
          type: message.decision, // "allow" | "deny" | "allow_session"
          reason: message.reason,
        })
      );
      break;
    }

    case "thread.stop": {
      await Effect.runPromise(providerService.stopThread(tid));
      ws.send(
        JSON.stringify({
          type: "thread.session.status",
          threadId,
          status: "idle",
        })
      );
      break;
    }

    default:
      ws.send(
        JSON.stringify({
          type: "thread.error",
          error: `Unknown command: ${message.type}`,
        })
      );
  }
}

function startEventFanOut(
  providerService: ProviderService,
  connections: Map<string, Set<ThreadConnection>>
): void {
  const stream = providerService.mergedEventStream();

  // Run stream consumer in background
  const program = Stream.runForEach(stream, (envelope: ProviderEventEnvelope) =>
    Effect.sync(() => {
      const threadConns = connections.get(envelope.threadId as string);
      if (!threadConns) return;

      const payload = JSON.stringify({
        type: "thread.event",
        event: envelope,
      });

      for (const conn of threadConns) {
        if (conn.ws.readyState === WebSocket.OPEN) {
          conn.ws.send(payload);
        }
      }
    })
  );

  // Run in background — don't await
  Effect.runFork(program.pipe(Effect.catchAll(() => Effect.void)));
}
```

**Step 2: Wire into server startup**

In `packages/server/src/index.ts`, update the startup section to also call `setupThreadWebSocket`:

Add import:

```typescript
import { setupThreadWebSocket } from "./api/thread-ws.js";
```

After `setupWebSocket(server);`, add:

```typescript
    setupThreadWebSocket(server, providerService);
```

Note: `providerService` needs to be accessible from the startup block. Refactor `createApp` to return both the app and the service, or create the service at the top level.

The simplest approach: make `createApp` return `{ app, providerService }`:

Change the `createApp` function signature and the startup block accordingly.

**Step 3: Verify build**

```bash
cd /data/github/devbox && bun run --filter @patchwork/server build
```

**Step 4: Commit**

```bash
git add packages/server/src/api/thread-ws.ts packages/server/src/index.ts
git commit -m "feat: add thread WebSocket handler with event fan-out"
```

---

## Phase 5: Thread UI

### Task 15: Add Thread API Methods to UI Client

**Files:**
- Modify: `packages/ui/src/lib/api.ts`

**Step 1: Add thread-related API methods**

Add these methods to the `api` object:

```typescript
  // Thread API
  async listThreads() {
    const res = await fetch("/api/threads", fetchOpts());
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async getThread(id: string) {
    const res = await fetch(`/api/threads/${id}`, fetchOpts());
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async createThread(data: {
    title: string;
    provider: string;
    model?: string;
    runtimeMode?: string;
    workspacePath: string;
    useSubscription?: boolean;
    issueId?: string;
  }) {
    const res = await fetch("/api/threads", {
      ...fetchOpts(),
      method: "POST",
      headers: { ...fetchOpts().headers, "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async sendTurn(threadId: string, text: string, model?: string) {
    const res = await fetch(`/api/threads/${threadId}/turns`, {
      ...fetchOpts(),
      method: "POST",
      headers: { ...fetchOpts().headers, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async approveRequest(threadId: string, requestId: string, decision: string) {
    const res = await fetch(`/api/threads/${threadId}/approve`, {
      ...fetchOpts(),
      method: "POST",
      headers: { ...fetchOpts().headers, "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, decision: { type: decision } }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async stopThread(threadId: string) {
    const res = await fetch(`/api/threads/${threadId}/stop`, {
      ...fetchOpts(),
      method: "POST",
      headers: fetchOpts().headers,
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async interruptThread(threadId: string) {
    const res = await fetch(`/api/threads/${threadId}/interrupt`, {
      ...fetchOpts(),
      method: "POST",
      headers: fetchOpts().headers,
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
```

**Step 2: Verify UI builds**

```bash
cd /data/github/devbox && bun run --filter @patchwork/ui build
```

**Step 3: Commit**

```bash
git add packages/ui/src/lib/api.ts
git commit -m "feat: add thread API methods to UI client"
```

---

### Task 16: Create WebSocket Hook for Threads

**Files:**
- Create: `packages/ui/src/hooks/use-thread-socket.ts`

**Step 1: Create the hook**

```typescript
// packages/ui/src/hooks/use-thread-socket.ts
"use client";

import { useEffect, useRef, useCallback, useState } from "react";

export interface ThreadEvent {
  type: string;
  event?: any;
  threadId?: string;
  status?: string;
  error?: string;
  turnId?: string;
}

interface UseThreadSocketOptions {
  threadId: string | null;
  onEvent?: (event: ThreadEvent) => void;
}

export function useThreadSocket({ threadId, onEvent }: UseThreadSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!threadId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/ws/threads?threadId=${threadId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        onEvent?.(data);
      } catch {
        // Ignore non-JSON messages
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [threadId, onEvent]);

  const send = useCallback(
    (message: Record<string, unknown>) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(message));
      }
    },
    []
  );

  const sendTurn = useCallback(
    (text: string, model?: string) => {
      send({ type: "thread.sendTurn", text, model });
    },
    [send]
  );

  const interrupt = useCallback(() => {
    send({ type: "thread.interrupt" });
  }, [send]);

  const approve = useCallback(
    (requestId: string, decision: "allow" | "deny" | "allow_session") => {
      send({ type: "thread.approval", requestId, decision });
    },
    [send]
  );

  const stop = useCallback(() => {
    send({ type: "thread.stop" });
  }, [send]);

  return { connected, sendTurn, interrupt, approve, stop, send };
}
```

**Step 2: Verify UI builds**

```bash
cd /data/github/devbox && bun run --filter @patchwork/ui build
```

**Step 3: Commit**

```bash
git add packages/ui/src/hooks/use-thread-socket.ts
git commit -m "feat: add useThreadSocket hook for real-time thread events"
```

---

### Task 17: Create Thread Timeline Components

**Files:**
- Create: `packages/ui/src/components/thread/timeline.tsx`
- Create: `packages/ui/src/components/thread/message-bubble.tsx`
- Create: `packages/ui/src/components/thread/approval-card.tsx`
- Create: `packages/ui/src/components/thread/work-item.tsx`

**Step 1: Create MessageBubble component**

```typescript
// packages/ui/src/components/thread/message-bubble.tsx
"use client";

import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
}

export function MessageBubble({ role, content, streaming }: MessageBubbleProps) {
  const isUser = role === "user";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-4 py-2.5 text-sm",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted/50 border border-border/40"
        )}
      >
        <div className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed">
          {content}
          {streaming && (
            <span className="inline-block w-1.5 h-4 bg-current animate-pulse ml-0.5" />
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Create ApprovalCard component**

```typescript
// packages/ui/src/components/thread/approval-card.tsx
"use client";

import { Button } from "@/components/ui/button";
import { Shield, Terminal, FileEdit, Plug } from "lucide-react";

interface ApprovalCardProps {
  requestId: string;
  toolName: string;
  toolCategory: string;
  description?: string;
  input?: Record<string, unknown>;
  resolved?: boolean;
  decision?: string;
  onApprove: (requestId: string, decision: "allow" | "deny" | "allow_session") => void;
}

const categoryIcons: Record<string, typeof Terminal> = {
  command_execution: Terminal,
  file_change: FileEdit,
  mcp_tool_call: Plug,
};

export function ApprovalCard({
  requestId,
  toolName,
  toolCategory,
  description,
  input,
  resolved,
  decision,
  onApprove,
}: ApprovalCardProps) {
  const Icon = categoryIcons[toolCategory] ?? Shield;

  return (
    <div className="border rounded-lg p-3 bg-amber-500/5 border-amber-500/20 space-y-2">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-amber-500" />
        <span className="text-sm font-medium">{toolName}</span>
        <span className="text-[10px] font-mono text-muted-foreground/60 uppercase">
          {toolCategory.replace("_", " ")}
        </span>
      </div>

      {description && (
        <p className="text-xs text-muted-foreground font-mono">{description}</p>
      )}

      {input && toolCategory === "command_execution" && input.command && (
        <pre className="text-xs bg-black/80 text-green-400 rounded px-3 py-2 font-mono overflow-x-auto">
          $ {String(input.command)}
        </pre>
      )}

      {resolved ? (
        <div className="text-xs font-mono text-muted-foreground/60">
          {decision === "allow" ? "Allowed" : decision === "deny" ? "Denied" : "Allowed for session"}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-green-500/30 text-green-600 hover:bg-green-500/10"
            onClick={() => onApprove(requestId, "allow")}
          >
            Allow
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-blue-500/30 text-blue-600 hover:bg-blue-500/10"
            onClick={() => onApprove(requestId, "allow_session")}
          >
            Allow All
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-red-500/30 text-red-600 hover:bg-red-500/10"
            onClick={() => onApprove(requestId, "deny")}
          >
            Deny
          </Button>
        </div>
      )}
    </div>
  );
}
```

**Step 3: Create WorkItem component**

```typescript
// packages/ui/src/components/thread/work-item.tsx
"use client";

import { useState } from "react";
import { ChevronRight, Terminal, FileEdit, FileSearch, Plug, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

interface WorkItemProps {
  toolName: string;
  toolCategory: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  completed: boolean;
}

const categoryIcons: Record<string, typeof Terminal> = {
  command_execution: Terminal,
  file_change: FileEdit,
  file_read: FileSearch,
  mcp_tool_call: Plug,
  dynamic_tool_call: Wrench,
};

export function WorkItem({ toolName, toolCategory, input, output, error, completed }: WorkItemProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = categoryIcons[toolCategory] ?? Wrench;

  const summary = toolCategory === "command_execution"
    ? String(input.command ?? "")
    : toolCategory === "file_change" || toolCategory === "file_read"
    ? String(input.file_path ?? input.path ?? "")
    : toolName;

  return (
    <div className="border rounded-md bg-muted/20 border-border/30">
      <button
        className="flex items-center gap-2 w-full px-3 py-1.5 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          className={cn("h-3 w-3 text-muted-foreground/40 transition-transform", expanded && "rotate-90")}
        />
        <Icon className="h-3.5 w-3.5 text-muted-foreground/50" />
        <span className="text-xs font-mono text-muted-foreground truncate flex-1">
          {summary}
        </span>
        {!completed && (
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
        )}
        {error && (
          <span className="text-[10px] text-red-500 font-mono">error</span>
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-1">
          {toolCategory === "command_execution" && input.command && (
            <pre className="text-xs bg-black/80 text-green-400 rounded px-2 py-1.5 font-mono overflow-x-auto">
              $ {String(input.command)}
            </pre>
          )}
          {output && (
            <pre className="text-xs bg-muted/50 rounded px-2 py-1.5 font-mono overflow-x-auto max-h-48 overflow-y-auto">
              {typeof output === "string" ? output : JSON.stringify(output, null, 2)}
            </pre>
          )}
          {error && (
            <pre className="text-xs text-red-400 bg-red-500/5 rounded px-2 py-1.5 font-mono">
              {error}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
```

**Step 4: Create Timeline component**

```typescript
// packages/ui/src/components/thread/timeline.tsx
"use client";

import { useRef, useEffect } from "react";
import { MessageBubble } from "./message-bubble";
import { ApprovalCard } from "./approval-card";
import { WorkItem } from "./work-item";

export interface TimelineItem {
  id: string;
  kind: "user_message" | "assistant_text" | "work_item" | "approval_request" | "error";
  content?: string;
  streaming?: boolean;
  // work_item fields
  toolName?: string;
  toolCategory?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string;
  completed?: boolean;
  // approval fields
  requestId?: string;
  description?: string;
  resolved?: boolean;
  decision?: string;
}

interface TimelineProps {
  items: TimelineItem[];
  onApprove: (requestId: string, decision: "allow" | "deny" | "allow_session") => void;
}

export function Timeline({ items, onApprove }: TimelineProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items.length]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
      {items.map((item) => {
        switch (item.kind) {
          case "user_message":
            return (
              <MessageBubble key={item.id} role="user" content={item.content ?? ""} />
            );

          case "assistant_text":
            return (
              <MessageBubble
                key={item.id}
                role="assistant"
                content={item.content ?? ""}
                streaming={item.streaming}
              />
            );

          case "work_item":
            return (
              <WorkItem
                key={item.id}
                toolName={item.toolName ?? "unknown"}
                toolCategory={item.toolCategory ?? "dynamic_tool_call"}
                input={item.input ?? {}}
                output={item.output}
                error={item.error}
                completed={item.completed ?? true}
              />
            );

          case "approval_request":
            return (
              <ApprovalCard
                key={item.id}
                requestId={item.requestId ?? ""}
                toolName={item.toolName ?? "unknown"}
                toolCategory={item.toolCategory ?? "dynamic_tool_call"}
                description={item.description}
                input={item.input}
                resolved={item.resolved}
                decision={item.decision}
                onApprove={onApprove}
              />
            );

          case "error":
            return (
              <div
                key={item.id}
                className="text-sm text-red-500 bg-red-500/5 border border-red-500/20 rounded-md px-3 py-2 font-mono"
              >
                {item.content}
              </div>
            );

          default:
            return null;
        }
      })}
      <div ref={bottomRef} />
    </div>
  );
}
```

**Step 5: Verify UI builds**

```bash
cd /data/github/devbox && bun run --filter @patchwork/ui build
```

**Step 6: Commit**

```bash
git add packages/ui/src/components/thread/
git commit -m "feat: add thread timeline components (messages, approvals, work items)"
```

---

### Task 18: Create Thread Composer Component

**Files:**
- Create: `packages/ui/src/components/thread/composer.tsx`

**Step 1: Create the composer**

```typescript
// packages/ui/src/components/thread/composer.tsx
"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Send, Square, Loader2 } from "lucide-react";

interface ComposerProps {
  onSend: (text: string, model?: string) => void;
  onInterrupt: () => void;
  onStop: () => void;
  running: boolean;
  connected: boolean;
  provider?: string;
  model?: string;
}

const MODELS: Record<string, string[]> = {
  claudeCode: [
    "claude-sonnet-4-20250514",
    "claude-opus-4-20250514",
    "claude-haiku-4-20250514",
  ],
  codex: ["codex-mini-latest", "o4-mini"],
};

export function Composer({
  onSend,
  onInterrupt,
  onStop,
  running,
  connected,
  provider,
  model: defaultModel,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [selectedModel, setSelectedModel] = useState(defaultModel ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed, selectedModel || undefined);
    setText("");
    textareaRef.current?.focus();
  }, [text, selectedModel, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const availableModels = provider ? MODELS[provider] ?? [] : [];

  return (
    <div className="border-t border-border/40 bg-background p-3">
      <div className="flex items-end gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={connected ? "Send a message..." : "Connecting..."}
            disabled={!connected}
            rows={1}
            className="w-full resize-none rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5 text-sm font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30 min-h-[40px] max-h-[200px]"
            style={{ height: "auto" }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = "auto";
              target.style.height = Math.min(target.scrollHeight, 200) + "px";
            }}
          />
        </div>

        <div className="flex items-center gap-1.5">
          {availableModels.length > 0 && (
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="h-9 rounded-md border border-border/40 bg-muted/20 px-2 text-[11px] font-mono text-muted-foreground"
            >
              {availableModels.map((m) => (
                <option key={m} value={m}>
                  {m.split("-").slice(0, 2).join(" ")}
                </option>
              ))}
            </select>
          )}

          {running ? (
            <>
              <Button
                size="icon"
                variant="outline"
                className="h-9 w-9 border-amber-500/30 text-amber-500 hover:bg-amber-500/10"
                onClick={onInterrupt}
                title="Interrupt"
              >
                <Square className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                className="h-9 w-9 border-red-500/30 text-red-500 hover:bg-red-500/10"
                onClick={onStop}
                title="Stop session"
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              </Button>
            </>
          ) : (
            <Button
              size="icon"
              className="h-9 w-9"
              onClick={handleSend}
              disabled={!text.trim() || !connected}
              title="Send (Cmd+Enter)"
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify UI builds**

```bash
cd /data/github/devbox && bun run --filter @patchwork/ui build
```

**Step 3: Commit**

```bash
git add packages/ui/src/components/thread/composer.tsx
git commit -m "feat: add thread composer with model picker and keyboard shortcuts"
```

---

### Task 19: Create Thread Page

**Files:**
- Create: `packages/ui/src/app/threads/page.tsx`
- Create: `packages/ui/src/app/threads/[id]/page.tsx`

**Step 1: Create thread list page**

```typescript
// packages/ui/src/app/threads/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Plus, MessageSquare, Loader2 } from "lucide-react";

interface ThreadItem {
  id: string;
  title: string;
  provider: string;
  model: string | null;
  status: string;
  runtimeMode: string;
  createdAt: string;
  updatedAt: string;
  _count: { turns: number; events: number };
}

export default function ThreadsPage() {
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listThreads()
      .then(setThreads)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold tracking-tight">Threads</h1>
        <Link href="/threads/new">
          <Button size="sm">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Thread
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : threads.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <MessageSquare className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No threads yet. Start a new session.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map((thread) => (
            <Link
              key={thread.id}
              href={`/threads/${thread.id}`}
              className="block border rounded-lg p-3 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{thread.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] font-mono text-muted-foreground/60">
                      {thread.provider}
                    </span>
                    {thread.model && (
                      <span className="text-[10px] font-mono text-muted-foreground/40">
                        {thread.model}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground/40">
                      {thread._count.turns} turns
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      thread.status === "active"
                        ? "bg-green-500/10 text-green-500"
                        : "bg-muted text-muted-foreground/60"
                    }`}
                  >
                    {thread.status}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Create thread detail page**

```typescript
// packages/ui/src/app/threads/[id]/page.tsx
"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { useThreadSocket, type ThreadEvent } from "@/hooks/use-thread-socket";
import { Timeline, type TimelineItem } from "@/components/thread/timeline";
import { Composer } from "@/components/thread/composer";
import { Loader2 } from "lucide-react";

export default function ThreadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [thread, setThread] = useState<any>(null);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const assistantTextRef = useRef<string>("");
  const assistantItemIdRef = useRef<string | null>(null);

  // Load thread data
  useEffect(() => {
    if (!id) return;
    api.getThread(id)
      .then((data) => {
        setThread(data);
        // Build initial timeline from persisted turns
        const initial: TimelineItem[] = [];
        for (const turn of data.turns ?? []) {
          initial.push({
            id: turn.id,
            kind: turn.role === "user" ? "user_message" : "assistant_text",
            content: turn.content ?? "",
          });
        }
        setItems(initial);
        setRunning(data.status === "active");
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  // Handle WebSocket events
  const handleEvent = useCallback((event: ThreadEvent) => {
    if (event.type === "thread.event" && event.event) {
      const e = event.event;

      switch (e.type) {
        case "content.delta": {
          if (e.payload.kind === "text") {
            assistantTextRef.current += e.payload.delta;
            const itemId = assistantItemIdRef.current ?? `text-${Date.now()}`;
            if (!assistantItemIdRef.current) {
              assistantItemIdRef.current = itemId;
            }
            setItems((prev) => {
              const existing = prev.findIndex((i) => i.id === itemId);
              const updated: TimelineItem = {
                id: itemId,
                kind: "assistant_text",
                content: assistantTextRef.current,
                streaming: true,
              };
              if (existing >= 0) {
                const next = [...prev];
                next[existing] = updated;
                return next;
              }
              return [...prev, updated];
            });
          }
          break;
        }

        case "turn.completed": {
          // Finalize streaming text
          if (assistantItemIdRef.current) {
            setItems((prev) =>
              prev.map((i) =>
                i.id === assistantItemIdRef.current
                  ? { ...i, streaming: false }
                  : i
              )
            );
          }
          assistantTextRef.current = "";
          assistantItemIdRef.current = null;
          setRunning(false);
          break;
        }

        case "item.started": {
          setItems((prev) => [
            ...prev,
            {
              id: e.payload.itemId,
              kind: "work_item",
              toolName: e.payload.toolName,
              toolCategory: e.payload.toolCategory,
              input: e.payload.input,
              completed: false,
            },
          ]);
          break;
        }

        case "item.completed": {
          setItems((prev) =>
            prev.map((i) =>
              i.id === e.payload.itemId
                ? { ...i, completed: true, output: e.payload.output, error: e.payload.error }
                : i
            )
          );
          break;
        }

        case "request.opened": {
          setItems((prev) => [
            ...prev,
            {
              id: `req-${e.payload.requestId}`,
              kind: "approval_request",
              requestId: e.payload.requestId,
              toolName: e.payload.toolName,
              toolCategory: e.payload.toolCategory,
              description: e.payload.description,
              input: e.payload.input,
              resolved: false,
            },
          ]);
          break;
        }

        case "request.resolved": {
          setItems((prev) =>
            prev.map((i) =>
              i.requestId === e.payload.requestId
                ? { ...i, resolved: true, decision: e.payload.decision }
                : i
            )
          );
          break;
        }

        case "runtime.error": {
          setItems((prev) => [
            ...prev,
            {
              id: `error-${Date.now()}`,
              kind: "error",
              content: e.payload.message,
            },
          ]);
          break;
        }

        case "session.exited": {
          setRunning(false);
          break;
        }
      }
    }

    if (event.type === "thread.session.status") {
      setRunning(event.status === "active");
    }
  }, []);

  const { connected, sendTurn, interrupt, approve, stop } = useThreadSocket({
    threadId: id,
    onEvent: handleEvent,
  });

  const handleSend = useCallback(
    (text: string, model?: string) => {
      // Add user message to timeline
      setItems((prev) => [
        ...prev,
        { id: `user-${Date.now()}`, kind: "user_message", content: text },
      ]);
      setRunning(true);
      assistantTextRef.current = "";
      assistantItemIdRef.current = null;
      sendTurn(text, model);
    },
    [sendTurn]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="border-b border-border/40 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-medium truncate max-w-md">
            {thread?.title ?? "Thread"}
          </h1>
          <span className="text-[10px] font-mono text-muted-foreground/60 px-1.5 py-0.5 rounded bg-muted">
            {thread?.provider}
          </span>
          {thread?.model && (
            <span className="text-[10px] font-mono text-muted-foreground/40">
              {thread.model}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              connected ? "bg-green-500" : "bg-red-500"
            }`}
          />
          <span className="text-[10px] text-muted-foreground/60">
            {connected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>

      {/* Timeline */}
      <Timeline items={items} onApprove={approve} />

      {/* Composer */}
      <Composer
        onSend={handleSend}
        onInterrupt={interrupt}
        onStop={stop}
        running={running}
        connected={connected}
        provider={thread?.provider}
        model={thread?.model}
      />
    </div>
  );
}
```

**Step 3: Verify UI builds**

```bash
cd /data/github/devbox && bun run --filter @patchwork/ui build
```

**Step 4: Commit**

```bash
git add packages/ui/src/app/threads/
git commit -m "feat: add thread list and detail pages with real-time streaming"
```

---

### Task 20: Add Threads to Navigation

**Files:**
- Modify: `packages/ui/src/components/nav.tsx`

**Step 1: Add Threads link to the navigation**

Find the existing nav links section and add a "Threads" link alongside "Board":

```typescript
<Link href="/threads" className={navLinkClass("/threads")}>
  Threads
</Link>
```

The exact insertion point depends on the current nav structure. Place it after the "Board" link.

**Step 2: Verify UI builds**

```bash
cd /data/github/devbox && bun run --filter @patchwork/ui build
```

**Step 3: Commit**

```bash
git add packages/ui/src/components/nav.tsx
git commit -m "feat: add Threads link to navigation"
```

---

## Phase 6: Diff Panel, Plan Mode, Terminal Drawer

### Task 21: Create Diff Panel Component

**Files:**
- Create: `packages/ui/src/components/thread/diff-panel.tsx`

**Step 1: Create the diff panel**

```typescript
// packages/ui/src/components/thread/diff-panel.tsx
"use client";

import { useState } from "react";
import { ChevronRight, FileEdit, Plus, Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DiffFile {
  path: string;
  status: "added" | "modified" | "deleted";
  hunks: Array<{
    header: string;
    lines: Array<{ type: "add" | "remove" | "context"; content: string }>;
  }>;
}

interface DiffPanelProps {
  files: DiffFile[];
  open: boolean;
  onClose: () => void;
}

export function DiffPanel({ files, open, onClose }: DiffPanelProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(
    files[0]?.path ?? null
  );

  if (!open) return null;

  const currentFile = files.find((f) => f.path === selectedFile);

  return (
    <div className="border-l border-border/40 flex flex-col bg-background" style={{ width: 480 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
        <span className="text-xs font-medium">
          Changes ({files.length} file{files.length !== 1 ? "s" : ""})
        </span>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* File tree */}
      <div className="border-b border-border/40 max-h-32 overflow-y-auto">
        {files.map((file) => (
          <button
            key={file.path}
            onClick={() => setSelectedFile(file.path)}
            className={cn(
              "flex items-center gap-2 w-full px-3 py-1.5 text-xs font-mono hover:bg-muted/30",
              selectedFile === file.path && "bg-muted/50"
            )}
          >
            <FileEdit className="h-3 w-3 text-muted-foreground/40" />
            <span className="truncate">{file.path}</span>
            <span
              className={cn(
                "text-[10px] ml-auto",
                file.status === "added" && "text-green-500",
                file.status === "deleted" && "text-red-500",
                file.status === "modified" && "text-amber-500"
              )}
            >
              {file.status}
            </span>
          </button>
        ))}
      </div>

      {/* Diff content */}
      <div className="flex-1 overflow-y-auto">
        {currentFile ? (
          <div className="font-mono text-xs">
            {currentFile.hunks.map((hunk, i) => (
              <div key={i}>
                <div className="bg-muted/30 px-3 py-1 text-muted-foreground/60 sticky top-0">
                  {hunk.header}
                </div>
                {hunk.lines.map((line, j) => (
                  <div
                    key={j}
                    className={cn(
                      "px-3 py-0.5 whitespace-pre",
                      line.type === "add" && "bg-green-500/10 text-green-700 dark:text-green-400",
                      line.type === "remove" && "bg-red-500/10 text-red-700 dark:text-red-400"
                    )}
                  >
                    <span className="select-none text-muted-foreground/30 mr-2">
                      {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                    </span>
                    {line.content}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground/40 text-xs">
            Select a file to view changes
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Verify UI builds**

```bash
cd /data/github/devbox && bun run --filter @patchwork/ui build
```

**Step 3: Commit**

```bash
git add packages/ui/src/components/thread/diff-panel.tsx
git commit -m "feat: add diff panel component for thread file changes"
```

---

### Task 22: Create Terminal Drawer Component

**Files:**
- Create: `packages/ui/src/components/thread/terminal-drawer.tsx`

**Step 1: Create the terminal drawer**

```typescript
// packages/ui/src/components/thread/terminal-drawer.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronUp, ChevronDown, Terminal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TerminalLine {
  id: string;
  content: string;
  timestamp: number;
}

interface TerminalDrawerProps {
  lines: TerminalLine[];
  open: boolean;
  onToggle: () => void;
}

export function TerminalDrawer({ lines, open, onToggle }: TerminalDrawerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines.length, open]);

  return (
    <div
      className={cn(
        "border-t border-border/40 bg-black/90 transition-all duration-200",
        open ? "h-64" : "h-8"
      )}
    >
      {/* Handle */}
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full px-3 h-8 text-xs text-green-400/70 hover:text-green-400"
      >
        <Terminal className="h-3 w-3" />
        <span className="font-mono">Terminal Output</span>
        <span className="ml-auto">
          {open ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronUp className="h-3 w-3" />
          )}
        </span>
      </button>

      {open && (
        <div
          ref={scrollRef}
          className="h-[calc(100%-2rem)] overflow-y-auto px-3 pb-2 font-mono text-xs text-green-400/90"
        >
          {lines.map((line) => (
            <div key={line.id} className="whitespace-pre-wrap break-all leading-relaxed">
              {line.content}
            </div>
          ))}
          {lines.length === 0 && (
            <div className="text-green-400/30 py-4 text-center">
              No terminal output yet
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Verify UI builds**

```bash
cd /data/github/devbox && bun run --filter @patchwork/ui build
```

**Step 3: Commit**

```bash
git add packages/ui/src/components/thread/terminal-drawer.tsx
git commit -m "feat: add terminal drawer component"
```

---

## Phase 7: Git Worktree Integration & Settings

### Task 23: Create Git Worktree Manager

**Files:**
- Create: `packages/server/src/providers/worktree.ts`

**Step 1: Create the worktree manager**

```typescript
// packages/server/src/providers/worktree.ts
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const execAsync = promisify(exec);

const WORKTREE_BASE = process.env.PATCHWORK_WORKTREE_DIR ?? "/tmp/patchwork/worktrees";

export interface WorktreeInfo {
  path: string;
  branch: string;
  threadId: string;
}

export class WorktreeManager {
  private repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  async create(threadId: string, branchName?: string): Promise<WorktreeInfo> {
    const safeBranch = branchName ?? `patchwork/${threadId.slice(0, 8)}`;
    const worktreePath = join(WORKTREE_BASE, threadId);

    // Ensure base directory exists
    if (!existsSync(WORKTREE_BASE)) {
      mkdirSync(WORKTREE_BASE, { recursive: true });
    }

    // Create worktree with new branch
    await execAsync(
      `git worktree add "${worktreePath}" -b "${safeBranch}"`,
      { cwd: this.repoPath }
    );

    return {
      path: worktreePath,
      branch: safeBranch,
      threadId,
    };
  }

  async remove(threadId: string): Promise<void> {
    const worktreePath = join(WORKTREE_BASE, threadId);

    if (existsSync(worktreePath)) {
      await execAsync(
        `git worktree remove "${worktreePath}" --force`,
        { cwd: this.repoPath }
      );
    }
  }

  async getDiff(threadId: string): Promise<string> {
    const worktreePath = join(WORKTREE_BASE, threadId);
    const { stdout } = await execAsync("git diff HEAD", {
      cwd: worktreePath,
    });
    return stdout;
  }

  async list(): Promise<WorktreeInfo[]> {
    const { stdout } = await execAsync("git worktree list --porcelain", {
      cwd: this.repoPath,
    });

    const entries: WorktreeInfo[] = [];
    let currentPath = "";
    let currentBranch = "";

    for (const line of stdout.split("\n")) {
      if (line.startsWith("worktree ")) {
        currentPath = line.slice(9);
      } else if (line.startsWith("branch ")) {
        currentBranch = line.slice(7).replace("refs/heads/", "");
      } else if (line === "") {
        if (currentPath.startsWith(WORKTREE_BASE)) {
          const threadId = currentPath.split("/").pop() ?? "";
          entries.push({
            path: currentPath,
            branch: currentBranch,
            threadId,
          });
        }
        currentPath = "";
        currentBranch = "";
      }
    }

    return entries;
  }
}
```

**Step 2: Verify build**

```bash
cd /data/github/devbox && bun run --filter @patchwork/server build
```

**Step 3: Commit**

```bash
git add packages/server/src/providers/worktree.ts
git commit -m "feat: add git worktree manager for thread isolation"
```

---

### Task 24: Add Provider Settings to UserSettings

**Files:**
- Modify: `packages/server/prisma/schema.prisma`
- Modify: `packages/server/src/api/settings.ts`

**Step 1: Add provider fields to UserSettings model**

Add these fields to the `UserSettings` model in the Prisma schema:

```prisma
  defaultProvider   String? @map("default_provider")
  defaultModel      String? @map("default_model")
  defaultRuntimeMode String? @map("default_runtime_mode")
```

**Step 2: Generate migration**

```bash
cd /data/github/devbox/packages/server && bun run prisma migrate dev --name add-provider-settings
```

**Step 3: Update settings API**

In `packages/server/src/api/settings.ts`, add the new fields to the update handler so they're accepted and persisted.

**Step 4: Verify build**

```bash
cd /data/github/devbox && bun run --filter @patchwork/server build
```

**Step 5: Commit**

```bash
git add packages/server/prisma/ packages/server/src/api/settings.ts
git commit -m "feat: add provider settings fields to user settings"
```

---

### Task 25: Add Provider Settings UI

**Files:**
- Modify: `packages/ui/src/app/settings/page.tsx`

**Step 1: Add provider configuration section**

Add a "Provider Configuration" section to the settings page with:
- Default provider dropdown (Claude Code / Codex)
- Default model text input
- Default runtime mode toggle (approval-required / full-access)
- Claude subscription toggle (existing)
- OpenAI subscription toggle (existing)

These fields map to the `UserSettings` API.

**Step 2: Verify UI builds**

```bash
cd /data/github/devbox && bun run --filter @patchwork/ui build
```

**Step 3: Commit**

```bash
git add packages/ui/src/app/settings/page.tsx
git commit -m "feat: add provider configuration to settings page"
```

---

## Phase 8: Codex Adapter & Polish

### Task 26: Create Codex Adapter Stub

**Files:**
- Create: `packages/server/src/providers/codex/adapter.ts`
- Create: `packages/server/src/providers/codex/index.ts`

**Step 1: Create stub adapter**

```typescript
// packages/server/src/providers/codex/adapter.ts
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

/**
 * CodexAdapter stub — placeholder for Codex SDK integration.
 * Full implementation in a future phase.
 */
export class CodexAdapter implements ProviderAdapterShape {
  readonly provider = "codex" as const;
  readonly capabilities: ProviderCapabilities = {
    sessionModelSwitch: "unsupported",
    supportsApprovals: false,
    supportsPlanMode: false,
    supportsResume: false,
  };

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
```

```typescript
// packages/server/src/providers/codex/index.ts
export { CodexAdapter } from "./adapter.js";
```

**Step 2: Register in the server**

In `packages/server/src/index.ts`, import and register:

```typescript
import { CodexAdapter } from "./providers/codex/index.js";

// Inside createApp, after registering ClaudeCodeAdapter:
adapterRegistry.register(new CodexAdapter());
```

**Step 3: Update provider barrel export**

Add to `packages/server/src/providers/index.ts`:

```typescript
export { CodexAdapter } from "./codex/index.js";
```

**Step 4: Verify build**

```bash
cd /data/github/devbox && bun run --filter @patchwork/server build
```

**Step 5: Commit**

```bash
git add packages/server/src/providers/codex/ packages/server/src/providers/index.ts packages/server/src/index.ts
git commit -m "feat: add Codex adapter stub"
```

---

### Task 27: Add Board "Start Session" Integration

**Files:**
- Modify: `packages/ui/src/app/board/[id]/page.tsx`

**Step 1: Add "Start Session" button to issue detail page**

Add a "Start Session" button that:
1. Calls `api.createThread({ title: issue.title, provider: "claudeCode", workspacePath: issue.repo, issueId: issue.id })`
2. On success, navigates to `/threads/${thread.id}`

This goes next to the existing "Queue" button in the issue detail view.

**Step 2: Verify UI builds**

```bash
cd /data/github/devbox && bun run --filter @patchwork/ui build
```

**Step 3: Commit**

```bash
git add packages/ui/src/app/board/
git commit -m "feat: add Start Session button to issue detail page"
```

---

### Task 28: Update Shared Types

**Files:**
- Modify: `packages/shared/src/types.ts`

**Step 1: Add thread-related types**

Add to the end of `packages/shared/src/types.ts`:

```typescript
// Thread types (provider adapter layer)

export type ProviderKind = "claudeCode" | "codex";
export type RuntimeMode = "approval-required" | "full-access";
export type ThreadStatus = "idle" | "starting" | "active" | "error";

export interface ThreadSummary {
  id: string;
  title: string;
  provider: ProviderKind;
  model: string | null;
  status: ThreadStatus;
  runtimeMode: RuntimeMode;
  issueId: string | null;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
}
```

**Step 2: Verify shared package builds**

```bash
cd /data/github/devbox && bun run --filter @patchwork/shared build
```

**Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat: add thread types to shared package"
```

---

### Task 29: Final Build Verification

**Step 1: Run full build**

```bash
cd /data/github/devbox
bun run --filter @patchwork/shared build
bun run --filter @patchwork/server build
bun run --filter @patchwork/ui build
```

**Step 2: Run tests**

```bash
bun run --filter @patchwork/server test
```

**Step 3: Fix any compilation errors found**

Review and fix any TypeScript errors, missing imports, or type mismatches.

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve build issues from provider adapter integration"
```

---

### Task 30: Update WebSocket Proxy in UI

**Files:**
- Modify: `packages/ui/next.config.ts` (or `next.config.js`)

**Step 1: Add WebSocket proxy for thread WS endpoint**

Ensure the Next.js proxy configuration forwards `/api/ws/threads` to the Express server's WebSocket endpoint at `ws://localhost:3001/ws/threads`.

If using the existing API proxy pattern, add the WebSocket upgrade handling.

**Step 2: Verify the proxy works**

```bash
cd /data/github/devbox && bun run --filter @patchwork/ui build
```

**Step 3: Commit**

```bash
git add packages/ui/next.config.*
git commit -m "feat: add WebSocket proxy for thread connections"
```

---

## Verification Checklist

After completing all tasks, verify:

1. `bun install` — all new deps install cleanly
2. `bun run --filter @patchwork/server prisma generate` — Prisma client generates with new Thread tables
3. `bun run --filter @patchwork/shared build` — shared package builds
4. `bun run --filter @patchwork/server build` — server compiles with provider adapters
5. `bun run --filter @patchwork/ui build` — UI builds with thread pages
6. Server starts and `/api/threads` endpoint responds
7. WebSocket connects at `/ws/threads?threadId=<id>`
8. Thread UI renders timeline, composer, approval cards
9. Claude Code adapter starts sessions and streams events
10. Board issue detail has "Start Session" button that opens thread
