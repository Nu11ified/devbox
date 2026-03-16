# IDE Buttons, Container Cleanup, Testing & Session Resume

**Date:** 2026-03-16
**Status:** Approved

## Overview

Four features to improve the developer workflow: IDE integration buttons for remote worktree access, container cleanup on thread archive, comprehensive test coverage, and session resume completion.

---

## 1. VS Code / Cursor IDE Buttons

### Goal

Allow users to open a thread's worktree in VS Code or Cursor via SSH remote, seeing agent file changes in real time.

### Design

**Setting storage:** Add `sshHost String? @map("ssh_host")` to the existing `UserSettings` model in `packages/server/prisma/schema.prisma`. Configurable from the existing Settings page.

**URI scheme:**
- VS Code: `vscode://vscode-remote/ssh-remote+{sshHost}{worktreePath}`
- Cursor: `cursor://vscode-remote/ssh-remote+{sshHost}{worktreePath}`

**UI placement:** Two icon buttons in the thread detail page header bar, alongside the existing Diff/Terminal/PR/Archive buttons. Only visible when the thread has a non-null `worktreePath` AND the user has configured `sshHost` in settings.

**Behavior:** `window.open(uri)` — the OS handles the protocol, launching the IDE with Remote SSH extension connecting to the worktree directory.

**Real-time sync:** Guaranteed by filesystem — the worktree is a real directory on the remote host. VS Code/Cursor file watchers detect changes automatically.

**Note:** The SSH host must be a machine the user can SSH into where the worktrees reside. For local dev (e.g., `THREADS_DIR=/tmp/patchwork`), `sshHost` can be `localhost` or left unconfigured (buttons hidden).

### Schema Change

```prisma
model UserSettings {
  // ... existing fields ...
  sshHost String? @map("ssh_host")
}
```

### API Changes

- Extend existing `GET /api/settings` to include `sshHost` in response
- Extend existing `PUT /api/settings` to accept and persist `sshHost`
- File: `packages/server/src/api/settings.ts` — add `sshHost` to the destructuring and `data` assignment

### UI Changes

- `packages/ui/src/app/projects/[projectId]/threads/[id]/page.tsx` — add VS Code and Cursor buttons to header
- `packages/ui/src/app/settings/page.tsx` — add SSH Host input field in connection settings

---

## 2. Container Cleanup on Archive

### Goal

When a thread is archived, stop the active session and destroy the devbox container. Currently archive only sets `archivedAt`.

### Design

**Thread archive endpoint changes** (`PATCH /api/threads/:id/archive` in `threads.ts`):

When archiving (not unarchiving):
1. Stop active session via `providerService.stopThread()` if thread status is active
2. Destroy devbox container via `devboxManager.destroy()` if `devboxId` is present
3. Set `archivedAt` to current timestamp

When unarchiving:
- Only clear `archivedAt` (no container re-creation)

This mirrors the cleanup logic already in the delete endpoint.

### Issue Archival

**New endpoint:** `PATCH /api/issues/:id/archive` in `issues.ts` (does not currently exist).

The `Issue` model already has an `archivedAt` column. This new endpoint:
1. Toggles `archivedAt` on the issue
2. If archiving AND the issue has an associated dispatched thread (via `Thread.issueId`), also archive that thread with the same cleanup (stop session, destroy devbox)

---

## 3. Comprehensive Test Coverage

### Goal

Add vitest tests for every major feature to ensure consistency and prevent regressions. Tests run via `bun run test` at the root.

### Current State

- Vitest is installed in `packages/server` with `vitest.config.ts`
- 20 test files exist in `packages/server/tests/`
- Root `package.json` has `"test": "bun --filter '*' test"`

### Test Plan

**Expand existing test files:**

| Area | File | Additional Coverage |
|------|------|----------|
| Threads API | `threads-api.test.ts` | Archive with container cleanup, PR creation, worktree lifecycle |
| DevboxManager | `devbox-manager.test.ts` | Edge cases: double-destroy, list filtering |
| Provider service | `provider-service.test.ts` | Resume flow, stop on archive |

**Create new test files:**

| Area | File | Coverage |
|------|------|----------|
| Projects API | `projects-api.test.ts` | CRUD, settings, list threads |
| Issues API | `issues-api.test.ts` | CRUD, dispatch to thread, archive with cleanup |
| Settings API | `settings-api.test.ts` | Get/update SSH host setting |
| Git worktrees | `worktree.test.ts` | Create, remove, list worktrees |
| Session persistence | `session-persistence.test.ts` | Session creation, cursor storage, resume flow |
| Archive search | `archive-search.test.ts` | Full-text search, filtering by project |
| WebSocket events | `thread-ws.test.ts` | Event streaming, message types, reconnection |

### Testing Strategy

- Use supertest for HTTP endpoint tests
- Mock external dependencies (Docker, Git, Claude SDK) where necessary
- Use a test database (Prisma with test schema) for DB-dependent tests
- Each test file is self-contained with setup/teardown

---

## 4. Session Resume Completion

### Goal

Complete the partially-implemented session resume feature so users can explicitly resume idle threads.

### Current State

- `resumeCursor` is captured from Claude SDK `init` message and stored in `ThreadSession`
- `ensureSession()` fetches the cursor and passes it to `adapter.startSession()`
- The adapter passes `opts.resume = resumeCursor` to the SDK's `query()`
- **Missing:** No UI to manually resume, no feedback event, no error handling

### Design

**Resume button:** Add a "Resume" action to idle threads in the thread detail page. Visible when `thread.status !== "active"` AND `thread.sessions?.[0]?.resumeCursor != null`. When clicked, sends a `thread.continueSession` WebSocket message.

**New WS message type:** Add `case "thread.continueSession"` to the WebSocket handler in `thread-ws.ts`. This is a NEW case (does not currently exist). Payload: `{ type: "thread.continueSession" }`. It calls `providerService.ensureSession()` which already handles resume via `resumeCursor`.

**Resume event:** Emit a `session.resumed` event from the provider service when resume succeeds. Payload: `{ sessionId: string; resumedFrom: string | null }`. Add this event type to the event type definitions in `packages/server/src/providers/events.ts`.

**Error handling:** If resume fails (e.g., session expired), fall back to starting a fresh session and notify the user via a `runtime.warning` event that context was lost.

### API Changes

- Add `case "thread.continueSession"` to `thread-ws.ts` WebSocket message handler
- Add `session.resumed` event type with payload `{ sessionId: string; resumedFrom: string | null }` to `events.ts`

### UI Changes

- Add "Resume" button to thread header (visible when `!running && thread.sessions?.[0]?.resumeCursor`)
- Show toast when resume succeeds (`session.resumed` event) or fails (`runtime.warning`)

---

## Non-Goals

- SSH server provisioning inside containers (VS Code connects to the host, not the container)
- Container re-creation on unarchive
- UI testing (React component tests) — server-side only for now
- Conversation replay from ThreadTurns (resume uses SDK cursor, not message replay)
