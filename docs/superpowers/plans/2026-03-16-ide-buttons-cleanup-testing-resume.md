# IDE Buttons, Container Cleanup, Testing & Session Resume — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add VS Code/Cursor IDE buttons to threads, clean up containers on archive, add comprehensive test coverage, and complete session resume.

**Architecture:** Four independent features: (1) SSH host setting + URI buttons in thread header, (2) archive endpoint gains cleanup logic, (3) vitest tests for all major APIs, (4) resume WS command + UI button. Each feature is self-contained and can be implemented in parallel.

**Tech Stack:** TypeScript, Express, Prisma, vitest, supertest, Next.js App Router, React, lucide-react

**Spec:** `docs/superpowers/specs/2026-03-16-ide-buttons-cleanup-testing-resume-design.md`

---

## Chunk 1: IDE Buttons (VS Code + Cursor)

### Task 1: Add `sshHost` to Prisma schema and settings API

**Files:**
- Modify: `packages/server/prisma/schema.prisma:279-298`
- Modify: `packages/server/src/api/settings.ts:39-66`

- [ ] **Step 1: Add sshHost field to UserSettings model**

In `packages/server/prisma/schema.prisma`, add after `anthropicApiKey`:

```prisma
  sshHost              String? @map("ssh_host")
```

- [ ] **Step 2: Run db push to sync schema**

Run: `cd packages/server && bunx prisma db push`
Expected: Schema synced, `ssh_host` column added to `user_settings` table

- [ ] **Step 3: Add sshHost to settings PUT handler**

In `packages/server/src/api/settings.ts`, add `sshHost` to the destructured fields (line 52) and to the conditional data assignment (after line 66):

```typescript
// In destructuring (line 39-52):
    sshHost,

// In data assignment (after line 66):
  if (sshHost !== undefined) data.sshHost = sshHost;
```

- [ ] **Step 4: Commit**

```bash
git add packages/server/prisma/schema.prisma packages/server/src/api/settings.ts
git commit -m "feat: add sshHost field to UserSettings for IDE remote access"
```

### Task 2: Add SSH Host input to Settings UI

**Files:**
- Modify: `packages/ui/src/components/settings-form.tsx`

- [ ] **Step 1: Add sshHost state and load from settings**

Add state variable alongside existing defaults (~line 246):

```typescript
const [sshHost, setSshHost] = useState("");
```

In the `api.getSettings().then(...)` callback (~line 265), add:

```typescript
if (s.sshHost) setSshHost(s.sshHost);
```

- [ ] **Step 2: Add save handler**

After `saveTeamSize` (~line 351):

```typescript
const saveSshHost = useCallback((v: string) => {
  setSshHost(v);
  api.updateSettings({ sshHost: v || null });
}, []);
```

- [ ] **Step 3: Add SSH Host section to the form**

Add a new `Section` after the "Agent Defaults" section, before the closing `</div>`:

```tsx
{/* ── Remote Access ──────────────────────────────────── */}
<Section
  icon={Globe}
  title="Remote Access"
  description="Configure SSH access for opening thread worktrees in VS Code or Cursor."
>
  <div className="space-y-1.5">
    <Label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
      SSH Host
    </Label>
    <Input
      placeholder="e.g. devbox.example.com"
      value={sshHost}
      onChange={(e) => saveSshHost(e.target.value)}
      className="bg-zinc-950/50 border-zinc-800/60 text-xs font-mono h-9 placeholder:text-zinc-600"
    />
    <p className="text-[10px] text-zinc-600">
      The SSH host where your worktrees live. Used by VS Code and Cursor "Open Remote" buttons on threads.
    </p>
  </div>
</Section>
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/settings-form.tsx
git commit -m "feat: add SSH Host input to settings UI"
```

### Task 3: Add VS Code and Cursor buttons to thread header

**Files:**
- Modify: `packages/ui/src/app/projects/[projectId]/threads/[id]/page.tsx`

- [ ] **Step 1: Add sshHost state and fetch on mount**

Add state variable (~line 38):

```typescript
const [sshHost, setSshHost] = useState<string | null>(null);
```

In the `useEffect` after `loadThread()` (~line 133), add a settings fetch:

```typescript
useEffect(() => {
  api.getSettings().then((s: any) => {
    if (s.sshHost) setSshHost(s.sshHost);
  }).catch(() => {});
}, []);
```

- [ ] **Step 2: Add button click handlers**

After `handleDelete` (~line 436):

```typescript
function openInIDE(scheme: "vscode" | "cursor") {
  if (!sshHost || !thread?.worktreePath) return;
  const uri = `${scheme}://vscode-remote/ssh-remote+${sshHost}${thread.worktreePath}`;
  window.open(uri, "_blank");
}
```

- [ ] **Step 3: Add the buttons to the header bar**

In the header button area, after the Terminal button and before the Rewind button (~line 500, after the Terminal `</button>`):

```tsx
{thread?.worktreePath && sshHost && (
  <>
    <button
      onClick={() => openInIDE("vscode")}
      className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono text-blue-500/70 hover:bg-blue-500/10 transition-colors"
      title="Open in VS Code (SSH Remote)"
    >
      <MonitorSmartphone className="h-3 w-3" />
      VS Code
    </button>
    <button
      onClick={() => openInIDE("cursor")}
      className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono text-purple-500/70 hover:bg-purple-500/10 transition-colors"
      title="Open in Cursor (SSH Remote)"
    >
      <MonitorSmartphone className="h-3 w-3" />
      Cursor
    </button>
  </>
)}
```

Add `MonitorSmartphone` to the lucide-react import at line 12.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/app/projects/[projectId]/threads/[id]/page.tsx
git commit -m "feat: add VS Code and Cursor IDE buttons to thread header"
```

---

## Chunk 2: Container Cleanup on Archive

### Task 4: Add cleanup logic to thread archive endpoint

**Files:**
- Modify: `packages/server/src/api/threads.ts:405-424`

- [ ] **Step 1: Write failing test for archive cleanup**

Add to `packages/server/tests/threads-api.test.ts`, in a new `describe("PATCH /api/threads/:id/archive")` block:

```typescript
describe("PATCH /api/threads/:id/archive", () => {
  it("stops session and destroys devbox when archiving active thread", async () => {
    vi.mocked(prisma.thread.findFirst).mockResolvedValueOnce({
      id: "thread-1",
      status: "active",
      devboxId: "ctr-archive-1",
      archivedAt: null,
    } as any);
    vi.mocked(prisma.thread.update).mockResolvedValueOnce({} as any);

    const res = await request(app).patch("/api/threads/thread-1/archive");

    expect(res.status).toBe(200);
    expect(res.body.archived).toBe(true);
    expect(mockPS.stopThread).toHaveBeenCalledTimes(1);
    expect(mockDevboxInstance.destroy).toHaveBeenCalledWith("ctr-archive-1");
  });

  it("does not cleanup when unarchiving", async () => {
    vi.mocked(prisma.thread.findFirst).mockResolvedValueOnce({
      id: "thread-1",
      status: "idle",
      devboxId: "ctr-archive-2",
      archivedAt: new Date(),
    } as any);
    vi.mocked(prisma.thread.update).mockResolvedValueOnce({} as any);

    const res = await request(app).patch("/api/threads/thread-1/archive");

    expect(res.status).toBe(200);
    expect(res.body.archived).toBe(false);
    expect(mockPS.stopThread).not.toHaveBeenCalled();
    expect(mockDevboxInstance.destroy).not.toHaveBeenCalled();
  });

  it("archive succeeds even if cleanup fails", async () => {
    mockDevboxInstance.destroy.mockRejectedValueOnce(new Error("container gone"));
    (mockPS.stopThread as any).mockReturnValueOnce(Effect.fail(new Error("dead")));

    vi.mocked(prisma.thread.findFirst).mockResolvedValueOnce({
      id: "thread-1",
      status: "active",
      devboxId: "ctr-bad",
      archivedAt: null,
    } as any);
    vi.mocked(prisma.thread.update).mockResolvedValueOnce({} as any);

    const res = await request(app).patch("/api/threads/thread-1/archive");

    expect(res.status).toBe(200);
    expect(res.body.archived).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && bun run test -- threads-api`
Expected: FAIL - stopThread and destroy not called during archive

- [ ] **Step 3: Implement cleanup in archive endpoint**

In `packages/server/src/api/threads.ts`, replace the archive handler body (lines 405-424) with:

```typescript
// Archive or unarchive a thread
router.patch("/:id/archive", async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const thread = await prisma.thread.findFirst({
      where: { id: req.params.id, ...(userId ? { userId } : {}) },
    });
    if (!thread) return res.status(404).json({ error: "Thread not found" });

    const archiving = !thread.archivedAt;
    const archivedAt = archiving ? new Date() : null;

    // Cleanup when archiving (not unarchiving)
    if (archiving) {
      try {
        if (thread.status === "active") {
          await Effect.runPromise(
            providerService.stopThread(ThreadId(thread.id))
          ).catch(() => {});
        }
        if (thread.devboxId) {
          await devboxManager.destroy(thread.devboxId).catch(() => {});
        }
      } catch {
        // Cleanup errors should not prevent archival
      }
    }

    await prisma.thread.update({
      where: { id: thread.id },
      data: { archivedAt },
    });

    res.json({ ok: true, archived: archiving });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && bun run test -- threads-api`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/api/threads.ts packages/server/tests/threads-api.test.ts
git commit -m "feat: stop session and destroy container on thread archive"
```

### Task 5: Add issue archive endpoint

**Files:**
- Modify: `packages/server/src/api/issues.ts`
- Create: `packages/server/tests/issues-api.test.ts`

- [ ] **Step 1: Write failing test for issue archive**

Create `packages/server/tests/issues-api.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import type { Express } from "express";

vi.mock("../src/db/prisma.js", () => ({
  default: {
    issue: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
    thread: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
    project: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock("../src/db/queries.js", () => ({
  insertIssue: vi.fn(),
  findAllIssues: vi.fn().mockResolvedValue([]),
  findIssueById: vi.fn().mockResolvedValue(null),
  updateIssue: vi.fn(),
  removeIssue: vi.fn(),
}));

import prisma from "../src/db/prisma.js";
import { issuesRouter } from "../src/api/issues.js";

function buildApp(userId?: string): Express {
  const app = express();
  if (userId) {
    app.use((req, _res, next) => {
      (req as any).user = { id: userId };
      next();
    });
  }
  app.use(express.json());
  app.use("/api/issues", issuesRouter);
  return app;
}

describe("Issues API", () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp("user-1");
  });

  describe("PATCH /api/issues/:id/archive", () => {
    it("archives an issue and sets archivedAt", async () => {
      vi.mocked(prisma.issue.findFirst).mockResolvedValueOnce({
        id: "issue-1",
        archivedAt: null,
      } as any);
      vi.mocked(prisma.issue.update).mockResolvedValueOnce({} as any);

      const res = await request(app).patch("/api/issues/issue-1/archive");

      expect(res.status).toBe(200);
      expect(res.body.archived).toBe(true);
      expect(prisma.issue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "issue-1" },
          data: expect.objectContaining({ archivedAt: expect.any(Date) }),
        })
      );
    });

    it("unarchives an issue", async () => {
      vi.mocked(prisma.issue.findFirst).mockResolvedValueOnce({
        id: "issue-1",
        archivedAt: new Date(),
      } as any);
      vi.mocked(prisma.issue.update).mockResolvedValueOnce({} as any);

      const res = await request(app).patch("/api/issues/issue-1/archive");

      expect(res.status).toBe(200);
      expect(res.body.archived).toBe(false);
    });

    it("returns 404 for nonexistent issue", async () => {
      const res = await request(app).patch("/api/issues/no-such/archive");

      expect(res.status).toBe(404);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && bun run test -- issues-api`
Expected: FAIL - archive endpoint does not exist

- [ ] **Step 3: Implement issue archive endpoint**

Add to `packages/server/src/api/issues.ts`, before the dispatch endpoint:

```typescript
// PATCH /api/issues/:id/archive - toggle archive
issuesRouter.patch("/:id/archive", async (req, res) => {
  try {
    const issue = await prisma.issue.findFirst({
      where: { id: req.params.id },
    });
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }

    const archiving = !issue.archivedAt;
    const archivedAt = archiving ? new Date() : null;

    await prisma.issue.update({
      where: { id: issue.id },
      data: { archivedAt },
    });

    res.json({ ok: true, archived: archiving });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && bun run test -- issues-api`
Expected: PASS

- [ ] **Step 5: Add archiveIssue to the UI API client**

In `packages/ui/src/lib/api.ts`, add after `dispatchIssue`:

```typescript
async archiveIssue(id: string): Promise<{ ok: boolean; archived: boolean }> {
  return request<{ ok: boolean; archived: boolean }>(`/api/issues/${id}/archive`, {
    method: "PATCH",
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/api/issues.ts packages/server/tests/issues-api.test.ts packages/ui/src/lib/api.ts
git commit -m "feat: add PATCH /api/issues/:id/archive endpoint with tests"
```

---

## Chunk 3: Session Resume Completion

### Task 6: Add `thread.continueSession` WS command

**Files:**
- Modify: `packages/server/src/api/thread-ws.ts:370`
- Modify: `packages/server/src/providers/events.ts`

- [ ] **Step 1: Add `session.resumed` event type**

In `packages/server/src/providers/events.ts`, add payload interface before `ProviderRuntimeEvent` union:

```typescript
export interface SessionResumedPayload {
  sessionId: string;
  resumedFrom: string | null;
}
```

Add to the `ProviderRuntimeEvent` union (before the closing `;`):

```typescript
  | { type: "session.resumed"; payload: SessionResumedPayload }
```

- [ ] **Step 2: Add WS command handler**

In `packages/server/src/api/thread-ws.ts`, add a new case before the `default:` case (~line 370):

```typescript
case "thread.continueSession": {
  const creds = await resolveUserCredentials(userId);
  await Effect.runPromise(
    providerService.ensureSession(tid, creds)
  );
  ws.send(JSON.stringify({
    type: "thread.session.status",
    threadId,
    status: "active",
  }));
  break;
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/api/thread-ws.ts packages/server/src/providers/events.ts
git commit -m "feat: add thread.continueSession WS command and session.resumed event"
```

### Task 7: Add Resume button to thread UI

**Files:**
- Modify: `packages/ui/src/app/projects/[projectId]/threads/[id]/page.tsx`

- [ ] **Step 1: Add resume handler**

After `handleDelete` in the thread page:

```typescript
function handleResume() {
  send({ type: "thread.continueSession" });
  setRunning(true);
}
```

- [ ] **Step 2: Determine resume eligibility**

Add a derived variable before the return statement:

```typescript
const canResume = !running && !loading && thread?.sessions?.[0]?.resumeCursor;
```

- [ ] **Step 3: Add Resume button to header**

In the button area, after the Fork button and before the PR button:

```tsx
{canResume && (
  <button
    onClick={handleResume}
    className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono text-cyan-500/70 hover:bg-cyan-500/10 transition-colors"
    title="Resume previous session"
  >
    <RotateCcw className="h-3 w-3" />
    Resume
  </button>
)}
```

Add `RotateCcw` to the lucide-react import.

- [ ] **Step 4: Handle session.resumed event**

Add a case in the `handleEvent` switch block:

```typescript
case "session.resumed": {
  setRunning(true);
  break;
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/app/projects/[projectId]/threads/[id]/page.tsx
git commit -m "feat: add Resume button to thread header for session continuation"
```

---

## Chunk 4: Comprehensive Test Coverage

### Task 8: Add settings API tests

**Files:**
- Create: `packages/server/tests/settings-api.test.ts`

- [ ] **Step 1: Create settings API test file**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import type { Express } from "express";

vi.mock("../src/db/prisma.js", () => ({
  default: {
    userSettings: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import prisma from "../src/db/prisma.js";
import { settingsRouter } from "../src/api/settings.js";

function buildApp(userId?: string): Express {
  const app = express();
  if (userId) {
    app.use((req, _res, next) => {
      (req as any).user = { id: userId };
      next();
    });
  }
  app.use(express.json());
  app.use("/api/settings", settingsRouter);
  return app;
}

describe("Settings API", () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp("user-1");
  });

  describe("GET /api/settings", () => {
    it("returns settings with masked API key", async () => {
      vi.mocked(prisma.userSettings.upsert).mockResolvedValueOnce({
        id: "s-1",
        userId: "user-1",
        anthropicApiKey: "sk-ant-api03-abcdef1234567890",
        sshHost: "devbox.example.com",
        defaultProvider: "claude-code",
      } as any);

      const res = await request(app).get("/api/settings");

      expect(res.status).toBe(200);
      expect(res.body.anthropicApiKey).toBe("****7890");
      expect(res.body.sshHost).toBe("devbox.example.com");
    });

    it("returns 401 when not authenticated", async () => {
      const appNoUser = buildApp();
      const res = await request(appNoUser).get("/api/settings");
      expect(res.status).toBe(401);
    });
  });

  describe("PUT /api/settings", () => {
    it("updates sshHost setting", async () => {
      vi.mocked(prisma.userSettings.upsert).mockResolvedValueOnce({
        id: "s-1",
        userId: "user-1",
        sshHost: "new-host.example.com",
      } as any);

      const res = await request(app)
        .put("/api/settings")
        .send({ sshHost: "new-host.example.com" });

      expect(res.status).toBe(200);
      expect(prisma.userSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ sshHost: "new-host.example.com" }),
        })
      );
    });

    it("updates multiple settings at once", async () => {
      vi.mocked(prisma.userSettings.upsert).mockResolvedValueOnce({} as any);

      const res = await request(app)
        .put("/api/settings")
        .send({
          defaultProvider: "claude-code",
          defaultModel: "claude-opus-4-6",
          sshHost: "dev.local",
        });

      expect(res.status).toBe(200);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd packages/server && bun run test -- settings-api`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/server/tests/settings-api.test.ts
git commit -m "test: add settings API tests covering sshHost and auth"
```

### Task 9: Add projects API tests

**Files:**
- Create: `packages/server/tests/projects-api.test.ts`

- [ ] **Step 1: Create projects API test file**

Read `packages/server/src/api/projects.ts` first to understand the router setup and handlers, then create tests covering:
- `POST /api/projects` - create with name+repo, missing fields returns 400
- `GET /api/projects` - list returns projects with counts
- `GET /api/projects/:id` - detail with threads and issues
- `DELETE /api/projects/:id` - cleanup and deletion
- `POST /api/projects/:id/merge-prs` - merge all thread PRs

Follow the same mock pattern as `threads-api.test.ts`: mock prisma, mock external deps, use supertest.

- [ ] **Step 2: Run tests**

Run: `cd packages/server && bun run test -- projects-api`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/server/tests/projects-api.test.ts
git commit -m "test: add projects API tests covering CRUD and merge-prs"
```

### Task 10: Add archive search tests

**Files:**
- Create: `packages/server/tests/archive-search.test.ts`

- [ ] **Step 1: Create archive search test file**

Read `packages/server/src/api/archive.ts` to understand the search implementation, then test:
- `GET /api/archive` - returns results with snippets
- `GET /api/archive?q=search` - full-text search
- `GET /api/archive?projectId=x` - filter by project
- Pagination: `page` and `limit` params

- [ ] **Step 2: Run and commit**

Run: `cd packages/server && bun run test -- archive-search`
Expected: PASS

```bash
git add packages/server/tests/archive-search.test.ts
git commit -m "test: add archive search tests covering full-text search and filtering"
```

### Task 11: Add git worktree tests

**Files:**
- Create: `packages/server/tests/worktree.test.ts`

- [ ] **Step 1: Create worktree test file**

Read `packages/server/src/git/worktree.ts` to understand the functions, then test:
- `createWorktree()` - calls execFileSync with correct args
- `removeWorktree()` - calls with --force flag
- `listWorktrees()` - parses porcelain output correctly

Mock `node:child_process` execFileSync.

- [ ] **Step 2: Run and commit**

Run: `cd packages/server && bun run test -- worktree`
Expected: PASS

```bash
git add packages/server/tests/worktree.test.ts
git commit -m "test: add git worktree utility tests"
```

### Task 12: Add session persistence tests

**Files:**
- Create: `packages/server/tests/session-persistence.test.ts`

- [ ] **Step 1: Create session persistence test file**

Test the session lifecycle through provider service methods:
- Session creation stores `ThreadSession` record
- Resume cursor is captured from SDK init message
- `ensureSession()` fetches and passes resume cursor
- Session status transitions: starting -> active -> completed

Mock prisma and the adapter. Verify the correct data flows through.

- [ ] **Step 2: Run and commit**

Run: `cd packages/server && bun run test -- session-persistence`
Expected: PASS

```bash
git add packages/server/tests/session-persistence.test.ts
git commit -m "test: add session persistence and resume cursor tests"
```

### Task 13: Expand existing thread tests for archive cleanup

**Files:**
- Modify: `packages/server/tests/threads-api.test.ts`

- [ ] **Step 1: Add worktree cleanup test to DELETE block**

In the existing `DELETE /api/threads/:id` describe block, add:

```typescript
it("removes git worktree when thread has worktreePath and projectId", async () => {
  vi.mocked(prisma.thread.findUnique).mockResolvedValueOnce({
    id: "thread-1",
    status: "idle",
    devboxId: null,
    worktreePath: "/projects/p1/worktrees/abc12345",
    projectId: "project-1",
  } as any);
  vi.mocked(prisma.project?.findUnique ?? vi.fn()).mockResolvedValueOnce({
    id: "project-1",
    workspacePath: "/projects/p1",
  } as any);

  const res = await request(app).delete("/api/threads/thread-1");

  expect(res.status).toBe(200);
});
```

- [ ] **Step 2: Run full thread tests**

Run: `cd packages/server && bun run test -- threads-api`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/server/tests/threads-api.test.ts
git commit -m "test: expand thread tests with worktree cleanup and archive scenarios"
```

### Task 14: Ensure root `bun run test` works end-to-end

**Files:**
- Verify: `package.json` (root)

- [ ] **Step 1: Run all tests from root**

Run: `bun run test`
Expected: All test files pass across all packages

- [ ] **Step 2: Verify test count**

Check output shows tests from:
- `packages/server/tests/` - all existing + new test files
- Any other package test suites

- [ ] **Step 3: Final commit if any adjustments needed**

```bash
git commit -m "test: ensure all tests pass with bun run test"
```

---

## Summary

| Task | Feature | Files | Type |
|------|---------|-------|------|
| 1 | IDE Buttons | schema + settings API | Backend |
| 2 | IDE Buttons | settings-form.tsx | Frontend |
| 3 | IDE Buttons | thread page.tsx | Frontend |
| 4 | Container Cleanup | threads.ts + test | Backend |
| 5 | Container Cleanup | issues.ts + test | Backend + Frontend |
| 6 | Session Resume | thread-ws.ts + events.ts | Backend |
| 7 | Session Resume | thread page.tsx | Frontend |
| 8 | Testing | settings-api.test.ts | Test |
| 9 | Testing | projects-api.test.ts | Test |
| 10 | Testing | archive-search.test.ts | Test |
| 11 | Testing | worktree.test.ts | Test |
| 12 | Testing | session-persistence.test.ts | Test |
| 13 | Testing | threads-api.test.ts (expand) | Test |
| 14 | Testing | root test runner | Verification |

**Parallelization:** Tasks 1-3 (IDE), 4-5 (Cleanup), 6-7 (Resume), 8-14 (Tests) are independent chunks and can be executed by parallel subagents.
