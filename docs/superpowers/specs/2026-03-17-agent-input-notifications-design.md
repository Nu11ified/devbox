# Agent Input Notification & Response UI — Design Spec

## Problem

When an agent running in a thread needs user input (e.g., approval of a plan, answering a question), the user has no way to know unless they're actively viewing that thread. The existing `ask_user` events render as read-only badges in the timeline — not interactive. There's no toast, no sidebar indicator, and no way to respond.

## Goals

1. Users are notified globally when any thread in the current project needs input
2. The `ask_user` interaction is fully interactive (clickable options + free-form text)
3. The sidebar clearly distinguishes "needs input" from "actively running"
4. Existing `ApprovalCard` (for `request.opened` events) remains unchanged

## Non-Goals

- Browser push notifications or sound alerts
- Answering input requests inline from the notification (always navigate to thread)
- Changing how `request.opened` / ApprovalCard works for non-AskUserQuestion tools

## Constraints

- **`AskUserQuestion` only fires in `permissionMode: "plan"`** — The `canUseTool` callback that intercepts `AskUserQuestion` is only wired in plan mode. In full-access mode (`bypassPermissions`), the agent cannot trigger ask_user events. This is expected and acceptable.
- **Effect streams are single-consumer** — The `mergedEventStream()` in the provider service uses Effect queues. A second independent consumer would starve the first. Project-level fan-out must be integrated into the existing fan-out loop, not created as a parallel consumer.
- **`thread.status` is transient** — It is a derived signal, not a durable event. It must NOT be persisted to the database (it's derivable from `ask_user` + `request.resolved` events) and must NOT be sent to thread-level WS clients (only project-level). The fan-out loop guards persistence and thread-level send behind `event.type !== "thread.status"`.

---

## Design

### 1. Thread Status — "Needs Input" State

**Runtime state, not persisted.** When the adapter emits an `ask_user` or `request.opened` event, the thread's effective status becomes `needs_input`. When the user responds via `respondToRequest`, it returns to `running`.

**WebSocket event:** A new `thread.status` event is emitted alongside existing events:
- `{ type: "thread.status", threadId, status: "needs_input", requestId, question, options? }` — when input is needed
- `{ type: "thread.status", threadId, status: "running" }` — when input is resolved

The server tracks pending request IDs per thread in the provider service (already partially done via the Deferred pattern in the adapter).

### 2. Toast Notification

When a `thread.status` event with `status: "needs_input"` arrives:

- A toast fires using the existing toast system
- New `warning` variant: amber-styled (matching sidebar dot)
- Content: thread name (truncated) + question preview (~60 chars)
- Auto-dismiss: 8 seconds (longer than default — user needs time to read)
- Click action: navigate to the thread page (`/projects/{projectId}/threads/{threadId}`)

Toast is fired from the project-level WebSocket hook (see Section 5).

### 3. Sidebar Amber Dot

In `project-sidebar.tsx`, the thread status dot system gains a new state:

| State | Dot | Priority |
|-------|-----|----------|
| needs_input | Amber pulse | Highest |
| active/running | Green pulse | Normal |
| idle | Gray | Low |
| error | Red | High |

`needs_input` takes priority over `active` — a thread can be running but also waiting for input.

The sidebar reads from a shared `usePendingInputs()` hook that maintains a `Map<threadId, { question, requestId }>` populated from project-level WS events.

### 4. Interactive AskUserCard Component

New component: `packages/ui/src/components/thread/ask-user-card.tsx`

Replaces the current read-only blue box with non-clickable badges.

**Layout (top to bottom):**

1. **Question text** — The agent's question, displayed prominently with a help-circle icon
2. **Option buttons** — If options provided by the agent, rendered as clickable pill/chip buttons. Clicking submits that option's `value` as the response
3. **Text input** — Always visible below options. Placeholder: "Type a custom response..." with a Send button. User can ignore options and type anything
4. **Resolved state** — After submission, card collapses to show question + user's chosen response (grayed out, non-interactive)

**Submission flow:**
1. User clicks option or types + clicks Send
2. Client sends the existing `thread.approval` WS command: `{ type: "thread.approval", requestId, decision: "allow", reason: <user's answer text> }`. This reuses the existing WS command and handler in `thread-ws.ts`. **However, the adapter currently drops the `reason` field for `allow` decisions.** The implementation must fix this:
   - Extend `ApprovalDecision`'s `allow` variant in `packages/server/src/providers/adapter.ts` to include `reason?: string`: `{ type: "allow"; reason?: string }`
   - Modify the adapter's AskUserQuestion branch (~line 542) to inject the user's answer into `updatedInput` so the SDK passes it back to the agent: `return { behavior: "allow", updatedInput: { ...input, result: decision.reason ?? "" } }`
3. Server resolves the Deferred in the adapter
4. Agent continues execution
5. `thread.status: running` event fires
6. Card transitions to resolved state

**Keyboard support:** Enter submits the text input. Option buttons are focusable and keyboard-navigable.

**Error handling:** If the WS send fails (disconnected), show an inline error message on the card with a Retry button.

**Coexistence with ApprovalCard:**
- `ask_user` events → `AskUserCard`
- `request.opened` events **where `toolName !== "AskUserQuestion"`** → `ApprovalCard` (unchanged)
- `request.opened` events **where `toolName === "AskUserQuestion"`** → suppressed from timeline rendering (the `ask_user` event already produces the `AskUserCard`)

This filtering is applied in `page.tsx` in both code paths:
- **Live events:** In `handleEvent`, when a `request.opened` event arrives with `toolName === "AskUserQuestion"`, skip adding it to timeline items
- **Historical reconstruction:** In `loadThread`, when iterating persisted events, skip `request.opened` entries with `toolName === "AskUserQuestion"`

### 5. Project-Level WebSocket

Currently, WebSocket connections are only established on individual thread pages. For global notifications, we need project-wide event awareness.

**Architecture: Extending the existing fan-out.** Effect streams are single-consumer, so we cannot create a parallel stream consumer. Instead, the existing `startEventFanOut` function in `thread-ws.ts` is extended:

- Maintain a `projectConnections: Map<projectId, Set<WebSocket>>` alongside the existing thread-level connections
- When the fan-out loop processes events, check if the event is a `thread.status` type. If so, look up the thread's `projectId` (via a `threadToProject: Map<threadId, projectId>` cache populated on WS connect from DB) and forward to all project-level subscribers
- Only `thread.status` events are forwarded to project connections — full message streams stay thread-only

**New endpoint:** `GET /api/projects/:id/events` (WebSocket)

- Registers the connection in `projectConnections` under the given projectId
- Authenticated via the same session/token pattern as thread WS
- On connect, queries DB for all active threads in the project with pending requests and sends initial state
- Lightweight — only receives `thread.status` events from the fan-out

**Client hook:** `useProjectEvents(projectId)` lives in the project layout (`packages/ui/src/app/projects/[projectId]/layout.tsx`).

- Connects to `/api/projects/:id/events`
- Maintains `pendingInputs: Map<threadId, { question, requestId, options?, threadName? }>`
- The hook closure has `projectId` from its argument — used for toast click navigation URLs
- On `needs_input`: fires toast, updates map
- On `running`: removes entry from map
- Exposes map via React context for sidebar + any other consumer

**Context provider:** `PendingInputsProvider` wraps the project layout, making `usePendingInputs()` available to:
- `project-sidebar.tsx` — amber dot rendering
- Toast system — notification firing
- Any future consumer

**Multiple concurrent toasts:** Toasts stack normally using the existing toast queue. No special limit — the user sees one toast per thread that needs input.

---

## File Changes

### New Files
- `packages/ui/src/components/thread/ask-user-card.tsx` — Interactive question response card
- `packages/ui/src/hooks/use-project-events.ts` — Project-level WS hook + PendingInputsProvider

### Modified Files
- `packages/server/src/providers/events.ts` — Add `ThreadStatusPayload` interface and `thread.status` variant to `ProviderRuntimeEvent` union
- `packages/server/src/providers/adapter.ts` — Extend `ApprovalDecision` allow variant with `reason?: string`
- `packages/server/src/providers/claude-code/adapter.ts` — Emit `thread.status` events alongside existing events; fix AskUserQuestion branch to pass `decision.reason` into `updatedInput.result`
- `packages/server/src/api/thread-ws.ts` — Extend `startEventFanOut` with `projectConnections` map and `threadToProject` cache; add project-level WS endpoint registration. **Important:** The fan-out loop must treat `thread.status` events differently — they are NOT persisted to the database (they are transient/derivable from `ask_user` + `request.resolved`) and are NOT sent to thread-level WS clients (only to project-level connections). Add a guard: `if (event.type !== "thread.status") { persistEvent(); sendToThreadClients(); }` then unconditionally check for project-level forwarding.
- `packages/server/src/api/index.ts` — Register project events WS route
- `packages/ui/src/components/thread/timeline.tsx` — Use `AskUserCard` for `ask_user` items; suppress `approval_request` items where `toolName === "AskUserQuestion"`
- `packages/ui/src/components/project-sidebar.tsx` — Consume `usePendingInputs()` for amber dot
- `packages/ui/src/components/ui/toast.tsx` — Add `warning` variant (amber styling)
- `packages/ui/src/app/projects/[projectId]/layout.tsx` — Wrap with `PendingInputsProvider`
- `packages/ui/src/app/projects/[projectId]/threads/[id]/page.tsx` — Wire up `AskUserCard` submission via existing `thread.approval` WS command; reconstruct `ask_user` items on thread reload

### Unchanged
- `packages/ui/src/components/thread/approval-card.tsx` — No changes (only handles non-AskUserQuestion requests)

---

## Event Flow

```
Agent calls AskUserQuestion tool
  → adapter.canUseTool intercepts
  → emits ask_user event (existing — renders AskUserCard in thread timeline)
  → emits request.opened event (existing — suppressed from timeline for AskUserQuestion)
  → emits thread.status { status: "needs_input", requestId, question, options } (NEW)
  → adapter creates Deferred, waits

Existing fan-out loop in startEventFanOut processes thread.status event
  → looks up projectId via threadToProject cache
  → forwards to all project-level WS subscribers

useProjectEvents receives thread.status event
  → pendingInputs map updated
  → sidebar re-renders with amber dot
  → toast fires with question preview (thread name from pendingInputs, projectId from hook closure)

User navigates to thread (via toast click or sidebar)
  → AskUserCard renders with options + text input
  → User clicks option or types response
  → WS sends thread.approval { requestId, decision: "allow", reason: <answer> }

Server receives thread.approval
  → resolves Deferred in adapter (answer read from reason field)
  → emits thread.status { status: "running" } (NEW)
  → agent continues

Project WS fans out running status
  → pendingInputs entry removed
  → sidebar returns to green dot
  → AskUserCard collapses to resolved state
```

## Historical Reconstruction

When a user navigates to a thread, `loadThread()` rebuilds timeline items from persisted events. For `ask_user` items:

1. The thread page already reconstructs `approval_request` items from stored events. The same pattern applies: `ask_user` events are persisted in the event log.
2. To determine resolved/unresolved state: check if a corresponding `request.resolved` event exists for the same `requestId`. If resolved, render `AskUserCard` in its collapsed/resolved state with the stored response. If unresolved, render as interactive.
3. The pending Deferred in the adapter is in-memory. If the server restarts while an `ask_user` is pending, the request is lost and the agent session would need to be resumed. This is an existing limitation of the approval system and is not changed by this spec.

## Known Limitations

- **Plan mode only:** `AskUserQuestion` only fires when `permissionMode === "plan"`. Full-access threads will never trigger these notifications.
- **Server restart:** In-memory Deferreds are lost on restart. A pending `ask_user` becomes unresolvable. The user would need to resume the thread session.
- **WS disconnect:** If the project-level WS drops and reconnects, the initial state sync (sent on connect) restores the `pendingInputs` map from DB query of active threads with pending requests.
