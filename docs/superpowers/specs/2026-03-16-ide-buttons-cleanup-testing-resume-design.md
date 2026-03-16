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

**Setting storage:** Add an `sshHost` field to the `User` model (or a new `UserSettings` model). Configurable from the existing Settings page.

**URI scheme:**
- VS Code: `vscode://vscode-remote/ssh-remote+{sshHost}{worktreePath}`
- Cursor: `cursor://vscode-remote/ssh-remote+{sshHost}{worktreePath}`

**UI placement:** Two icon buttons in the thread detail page header bar, alongside the existing Diff/Terminal/PR/Archive buttons. Only visible when the thread has a non-null `worktreePath`.

**Behavior:** `window.open(uri)` — the OS handles the protocol, launching the IDE with Remote SSH extension connecting to the worktree directory.

**Real-time sync:** Guaranteed by filesystem — the worktree is a real directory on the remote host. VS Code/Cursor file watchers detect changes automatically.

### API Changes

- `GET /api/settings` — returns user settings including `sshHost`
- `PUT /api/settings` — updates user settings (sshHost, etc.)
- Settings stored on the `User` model or a related `UserSettings` record

### UI Changes

- `packages/ui/src/app/projects/[projectId]/threads/[id]/page.tsx` — add VS Code and Cursor buttons to header
- `packages/ui/src/app/settings/page.tsx` — add SSH Host input field

---

## 2. Container Cleanup on Archive

### Goal

When a thread is archived, stop the active session and destroy the devbox container. Currently archive only sets `archivedAt`.

### Design

**Archive endpoint changes** (`PATCH /api/threads/:id/archive`):

When archiving (not unarchiving):
1. Stop active session via `providerService.stopThread()` if thread status is active
2. Destroy devbox container via `devboxManager.destroy()` if `devboxId` is present
3. Set `archivedAt` to current timestamp

When unarchiving:
- Only clear `archivedAt` (no container re-creation)

This mirrors the cleanup logic already in the delete endpoint.

### Issue Archival

Same treatment for issues — if issues have associated threads (dispatched worktree threads), archiving the issue should also clean up those thread containers.

---

## 3. Comprehensive Test Coverage

### Goal

Add vitest tests for every major feature to ensure consistency and prevent regressions. Tests run via `bun run test` at the root.

### Current State

- Vitest is installed in `packages/server` with `vitest.config.ts`
- ~20 test files exist in `packages/server/tests/`
- Root `package.json` has `"test": "bun --filter '*' test"`

### Test Plan

Add or expand tests for:

| Area | File | Coverage |
|------|------|----------|
| Threads API | `threads-api.test.ts` | CRUD, send turn, archive with cleanup, delete with cleanup, PR creation |
| Projects API | `projects-api.test.ts` | CRUD, settings, list threads |
| Issues API | `issues-api.test.ts` | CRUD, dispatch to thread, archive |
| Settings API | `settings-api.test.ts` | Get/update SSH host setting |
| Git worktrees | `worktree.test.ts` | Create, remove, list worktrees |
| DevboxManager | `devbox-manager.test.ts` | Create, exec, destroy, list (expand existing) |
| Session persistence | `session-persistence.test.ts` | Session creation, cursor storage, resume flow |
| Archive search | `archive-search.test.ts` | Full-text search, filtering |
| Provider service | `provider-service.test.ts` | Start/stop/resume sessions (expand existing) |
| WebSocket events | `thread-ws.test.ts` | Event streaming, reconnection |

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

**Resume button:** Add a "Resume" action to idle threads in the thread detail page. When clicked, sends a `thread.continueSession` WebSocket message (the parameter already exists in the API).

**Resume event:** Emit a `session.resumed` event from the provider service when resume succeeds, so the UI can display a notification or status indicator.

**Error handling:** If resume fails (e.g., session expired), fall back to starting a fresh session and notify the user that context was lost.

### API Changes

- Wire existing `continueSession` parameter in thread-ws message handler
- Add `session.resumed` event type to the event stream

### UI Changes

- Add "Resume" button to thread header (visible when thread is idle and has a previous session)
- Show toast/status when resume succeeds or fails

---

## Non-Goals

- SSH server provisioning inside containers (VS Code connects to the host, not the container)
- Container re-creation on unarchive
- UI testing (React component tests) — server-side only for now
- Conversation replay from ThreadTurns (resume uses SDK cursor, not message replay)
