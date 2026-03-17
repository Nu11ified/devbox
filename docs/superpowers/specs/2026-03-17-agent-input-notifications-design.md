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
- Changing how `request.opened` / ApprovalCard works

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
2. Client sends `thread.respondToRequest` via WebSocket with `{ requestId, response }`
3. Server resolves the Deferred in the adapter
4. Agent continues execution
5. `thread.status: running` event fires
6. Card transitions to resolved state

**Coexistence:** `ask_user` events → `AskUserCard`. `request.opened` events → `ApprovalCard` (unchanged). The timeline component switches based on event type.

### 5. Project-Level WebSocket

Currently, WebSocket connections are only established on individual thread pages. For global notifications, we need project-wide event awareness.

**New endpoint:** `GET /api/projects/:id/events` (WebSocket)

- Subscribes to `thread.status` events for all threads in the project
- Lightweight — only status events, not full message streams
- Authenticated via the same session/token pattern as thread WS

**Client hook:** `useProjectEvents(projectId)` lives in the project layout (`packages/ui/src/app/projects/[projectId]/layout.tsx`).

- Connects to `/api/projects/:id/events`
- Maintains `pendingInputs: Map<threadId, { question, requestId, options? }>`
- On `needs_input`: fires toast, updates map
- On `running`: removes entry from map
- Exposes map via React context for sidebar + any other consumer

**Context provider:** `PendingInputsProvider` wraps the project layout, making `usePendingInputs()` available to:
- `project-sidebar.tsx` — amber dot rendering
- Toast system — notification firing
- Any future consumer

---

## File Changes

### New Files
- `packages/ui/src/components/thread/ask-user-card.tsx` — Interactive question response card
- `packages/ui/src/hooks/use-project-events.ts` — Project-level WS hook + PendingInputsProvider
- `packages/server/src/api/project-events-ws.ts` — Project-level WS endpoint

### Modified Files
- `packages/server/src/providers/claude-code/adapter.ts` — Emit `thread.status` events alongside existing events
- `packages/server/src/api/index.ts` — Register project events WS route
- `packages/ui/src/components/thread/timeline.tsx` — Use `AskUserCard` for `ask_user` items instead of read-only badges
- `packages/ui/src/components/project-sidebar.tsx` — Consume `usePendingInputs()` for amber dot
- `packages/ui/src/components/ui/toast.tsx` — Add `warning` variant (amber styling)
- `packages/ui/src/app/projects/[projectId]/layout.tsx` — Wrap with `PendingInputsProvider`
- `packages/ui/src/app/projects/[projectId]/threads/[id]/page.tsx` — Wire up `AskUserCard` submission via existing WS

### Unchanged
- `packages/ui/src/components/thread/approval-card.tsx` — No changes
- `packages/server/src/providers/events.ts` — Existing `AskUserPayload` and `RequestOpenedPayload` sufficient

---

## Event Flow

```
Agent calls AskUserQuestion tool
  → adapter.canUseTool intercepts
  → emits ask_user event (existing)
  → emits request.opened event (existing)
  → emits thread.status { status: "needs_input", requestId, question, options } (NEW)
  → adapter creates Deferred, waits

Project WS endpoint fans out thread.status to all project subscribers
  → useProjectEvents receives event
  → pendingInputs map updated
  → sidebar re-renders with amber dot
  → toast fires with question preview

User navigates to thread (via toast click or sidebar)
  → AskUserCard renders with options + text input
  → User clicks option or types response
  → WS sends thread.respondToRequest { requestId, response }

Server receives response
  → resolves Deferred in adapter
  → emits thread.status { status: "running" } (NEW)
  → agent continues

Project WS fans out running status
  → pendingInputs entry removed
  → sidebar returns to green dot
  → AskUserCard collapses to resolved state
```
