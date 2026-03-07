# Provider Adapter Layer & Interactive Thread UI

**Date:** 2026-03-06
**Status:** Approved
**Approach:** Full replacement of agent execution layer with Effect-TS provider adapters

## Context

Patchwork currently runs agents as fire-and-forget PTY sessions inside Docker containers. Users queue issues, the orchestrator dispatches them, and they watch raw PTY output. There is no interactive approval, no plan mode, no ability to pause/resume or switch models mid-session.

This design replaces the entire agent execution layer with a provider adapter system inspired by [t3code](https://github.com/pingdotgg/t3code). The new system supports both interactive sessions (human-in-the-loop with approvals) and autonomous dispatch (unattended batch processing), unified behind a single adapter interface.

## Architecture

```
Browser ──> Next.js (port 3000)
              ├── /threads/[id]   → Interactive thread UI (WebSocket)
              ├── /board          → Issue board (queue + start session)
              └── /api/*          → Proxy to Express server

Express Server (port 3001)
              ├── WebSocket server (thread events, commands, approvals)
              ├── ProviderService (Effect-TS, thread routing)
              │     ├── ProviderAdapterRegistry
              │     │     ├── ClaudeCodeAdapter (@anthropic-ai/claude-agent-sdk)
              │     │     └── CodexAdapter (Codex SDK)
              │     └── ProviderSessionDirectory (Prisma persistence)
              ├── OrchestrationEngine (thread lifecycle, event store)
              ├── Orchestrator (poll loop for autonomous dispatch)
              └── Git worktree manager

              ┌─────────┴─────────┐
              PostgreSQL          Redis
              (Prisma ORM)        (cache)
```

## 1. Provider Adapter Interface

Every agent provider implements `ProviderAdapterShape`:

```typescript
interface ProviderAdapterShape {
  readonly provider: ProviderKind; // "claudeCode" | "codex"
  readonly capabilities: {
    sessionModelSwitch: "in-session" | "restart-session" | "unsupported";
    supportsApprovals: boolean;
    supportsPlanMode: boolean;
    supportsResume: boolean;
  };

  startSession(input: SessionStartInput): Effect<ProviderSession, AdapterError>;
  stopSession(threadId: ThreadId): Effect<void, AdapterError>;
  stopAll(): Effect<void, AdapterError>;

  sendTurn(input: SendTurnInput): Effect<TurnStartResult, AdapterError>;
  interruptTurn(threadId: ThreadId): Effect<void, AdapterError>;

  respondToRequest(
    threadId: ThreadId,
    requestId: string,
    decision: ApprovalDecision
  ): Effect<void, AdapterError>;

  readThread(threadId: ThreadId): Effect<ThreadSnapshot, AdapterError>;
  rollbackThread(threadId: ThreadId, numTurns: number): Effect<ThreadSnapshot, AdapterError>;

  streamEvents: Stream<ProviderRuntimeEvent>;
}
```

### Execution Modes

Both adapters support two runtime modes:

- **`approval-required`** (interactive): Tool calls emit `request.opened` events and block via `Deferred` until the user responds through the UI. Used for interactive sessions.
- **`full-access`** (autonomous): All tool calls auto-approved. Used for orchestrator-dispatched issues. The user's subscription or API key is injected at session start.

### Session Start Input

```typescript
interface SessionStartInput {
  threadId: ThreadId;
  provider: ProviderKind;
  model?: string;
  runtimeMode: "approval-required" | "full-access";
  workspacePath: string;
  useSubscription: boolean;
  apiKey?: string;
  githubToken?: string;
  resumeCursor?: unknown;
}
```

### Error Types

```typescript
type AdapterError =
  | SessionNotFoundError
  | SessionClosedError
  | ProcessError
  | RequestError
  | ValidationError;
```

Recovery: ProcessError → auto-restart with resume cursor. RequestError with rate limit → exponential backoff. SessionClosedError → recreate and replay.

## 2. Provider Implementations

### ClaudeCodeAdapter

Uses `@anthropic-ai/claude-agent-sdk`. The SDK's `query()` returns an `AsyncIterable` of messages. The adapter:

1. Creates an `Effect.Stream` from the SDK's async iterable
2. Maps each SDK message type to canonical `ProviderRuntimeEvent`s
3. Handles approvals via the SDK's `canUseTool` callback using `Deferred` for async resolution
4. Manages resume cursors (session UUID persisted for recovery)
5. Passes `--subscription` flag when `useSubscription` is true

Tool classification by name: bash/shell → `command_execution`, edit/write/file → `file_change`, mcp → `mcp_tool_call`, everything else → `dynamic_tool_call`.

### CodexAdapter

Uses the Codex CLI SDK with JSON-RPC for bidirectional communication. Similar event mapping pattern.

## 3. Canonical Event Model

All adapters emit `ProviderRuntimeEvent`s with these categories:

| Category | Events | Purpose |
|----------|--------|---------|
| Session | `session.started`, `session.configured`, `session.exited` | Lifecycle |
| Turn | `turn.started`, `turn.completed`, `turn.plan.updated` | Turn boundaries |
| Content | `content.delta` (text, reasoning, plan) | Streaming output |
| Items | `item.started`, `item.completed` (tool calls, file changes) | Work log |
| Requests | `request.opened`, `request.resolved` | Approval flow |
| Errors | `runtime.error`, `runtime.warning` | Error handling |

Each event carries: `type`, `eventId`, `provider`, `threadId`, `turnId?`, `payload`, `createdAt`, `raw?` (original provider event for debugging).

## 4. Orchestration Engine

### Thread-Centric Model

Every interaction is a Thread. The orchestration engine:

1. Creates threads (from UI or issue dispatch)
2. Routes turns to the correct provider adapter via `ProviderAdapterRegistry`
3. Persists thread-to-provider bindings via `ProviderSessionDirectory`
4. Manages turn lifecycle (start, stream, interrupt, complete)
5. Routes approval decisions from UI to adapter
6. Stores events in the database

```
Issue (board) ──dispatch──> Thread ──adapter──> Provider Session
User (UI) ──────────────> Thread ──adapter──> Provider Session
```

### Orchestrator Adaptation

The poll-based orchestrator is simplified:

```
Old: Orchestrator → Dispatcher → DevboxManager → BlueprintEngine → PTY Agent
New: Orchestrator → Dispatcher → ProviderService.startSession(full-access) → Adapter
```

The dispatcher resolves user provider preferences and subscription settings, creates a thread, starts a session in `full-access` mode, and sends the task as the first turn. Blueprint execution maps each node to a turn.

### Database Schema Additions

```prisma
model Thread {
  id            String   @id @default(uuid())
  title         String
  provider      String
  model         String?
  runtimeMode   String   @default("approval-required")
  status        String   @default("idle")
  issueId       String?  @unique
  issue         Issue?   @relation(fields: [issueId], references: [id])
  sessions      ThreadSession[]
  turns         ThreadTurn[]
  events        ThreadEvent[]
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@map("threads")
}

model ThreadSession {
  id            String   @id @default(uuid())
  threadId      String
  thread        Thread   @relation(fields: [threadId], references: [id])
  provider      String
  resumeCursor  Json?
  status        String   @default("starting")
  startedAt     DateTime @default(now())
  endedAt       DateTime?
  @@map("thread_sessions")
}

model ThreadTurn {
  id            String   @id @default(uuid())
  threadId      String
  thread        Thread   @relation(fields: [threadId], references: [id])
  turnId        String
  status        String   @default("running")
  startedAt     DateTime @default(now())
  completedAt   DateTime?
  tokenUsage    Json?
  @@map("thread_turns")
}

model ThreadEvent {
  id            String   @id @default(uuid())
  threadId      String
  thread        Thread   @relation(fields: [threadId], references: [id])
  turnId        String?
  type          String
  payload       Json
  sequence      Int
  createdAt     DateTime @default(now())
  @@index([threadId, sequence])
  @@map("thread_events")
}
```

## 5. WebSocket Transport

Bidirectional WebSocket for interactive sessions:

### Client → Server (commands)

- `thread.sendTurn` — Send user message (with provider, model, text, attachments)
- `thread.interrupt` — Interrupt current turn
- `thread.approval` — Respond to approval request (allow/deny/allowForSession)
- `thread.rollback` — Roll back N turns
- `thread.stop` — Stop session

### Server → Client (events)

- `thread.event` — Canonical `ProviderRuntimeEvent` (content deltas, items, turn completion)
- `thread.approval.request` — Tool approval request (command, file change, etc.)
- `thread.session.status` — Session state changes (connecting, ready, running, error)

## 6. UI Design

### Thread View (`/threads/[id]`)

Two-panel layout: chat/timeline on left, diff panel on right (resizable, collapsible).

**Timeline** — Unified view mixing:
- User messages (with markdown)
- Assistant responses (streaming with markdown rendering)
- Work items inline (file reads, file writes, commands with expandable output)
- Approval request cards with Allow/Allow All/Deny buttons
- Plan proposals with Accept/Reject
- Error cards with retry option

**Composer** — Bottom bar with:
- Multi-provider model picker (grouped by provider with logos)
- Text input area
- Runtime mode toggle (approval-required / full-access)
- Send button / keyboard shortcut (Cmd+Enter)

**Diff panel** — Resizable right panel:
- File tree of changes
- Syntax-highlighted unified diffs
- Toggle per-turn vs full-thread diff

**Terminal drawer** — Expandable bottom drawer:
- Real-time command output
- Multiple terminal tabs per thread

### Board Integration

Issue cards gain a "Start Session" button:
- **Queue** → autonomous dispatch (full-access, orchestrator handles it)
- **Start Session** → opens `/threads/[id]` in interactive mode
- Issues linked to threads show live thread status

### Settings Updates

Provider configuration section:
- Provider selection (Claude Code, Codex)
- Per-provider: subscription toggle, API key, custom model slugs
- Default runtime mode
- Default provider for new sessions

## 7. Git Worktree Integration

Each thread gets its own git worktree:

1. Create: `git worktree add /tmp/patchwork/worktrees/<threadId> -b patchwork/<branch-name>`
2. Set as `workspacePath` for the adapter
3. Agent operates in isolation
4. On completion: collect diff, clean up or keep for review

Branch names auto-generated from thread description (e.g., `patchwork/fix-auth-middleware`). For autonomous dispatch, branch names come from the issue.

## 8. Implementation Phases

| Phase | Scope | Dependencies |
|-------|-------|-------------|
| 1. Foundation | Effect-TS setup, adapter interface, event types, Prisma schema | None |
| 2. Claude Code Adapter | Claude Agent SDK integration, event mapping, approval handling | Phase 1 |
| 3. Orchestration Engine | ProviderService, session directory, event stream merging, adapted orchestrator/dispatcher | Phase 1-2 |
| 4. WebSocket Transport | Bidirectional WS server, command dispatch, event fan-out, approval routing | Phase 3 |
| 5. Thread UI | Timeline, composer, approval cards, content streaming, work log | Phase 4 |
| 6. Diff + Plan + Terminal | Diff panel, plan mode rendering, terminal drawer | Phase 5 |
| 7. Worktrees + Settings | Git worktree management, provider settings, model selection UI | Phase 5 |
| 8. Codex Adapter + Polish | Second adapter, cleanup, testing, remove old agent system | Phase 3 |

## Dependencies (new packages)

**Server:**
- `effect` — Core Effect-TS runtime
- `@effect/schema` — Runtime validation
- `@anthropic-ai/claude-agent-sdk` — Claude Code adapter

**UI:**
- No new framework dependencies (uses existing React + Tailwind)

## Migration Plan

1. Old agent system (`agents/`, `orchestrator/dispatcher.ts`) continues working during phases 1-3
2. Phase 3 cuts over the orchestrator to use the new adapter system
3. Old `agents/` directory removed after phase 8 validation
4. `transcript_events` table migrated to `thread_events`
5. Existing runs remain queryable (read-only) at `/runs/[id]`
