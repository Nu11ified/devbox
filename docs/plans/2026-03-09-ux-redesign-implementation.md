# UX Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign Patchwork around a project-centric model with multi-session worktrees, top bar navigation, command palette, and board-thread integration.

**Architecture:** Project (devbox + repo) contains Threads (each with optional git worktree). Issues belong to Projects and auto-create Threads when dispatched. Top bar for global nav, contextual left sidebar for project/thread context. Cmd+K command palette for keyboard-driven navigation.

**Tech Stack:** Next.js 16 App Router, Tailwind CSS v4, Prisma, Express, Effect-TS, Claude Agent SDK, xterm.js, lucide-react

**Design Doc:** `docs/plans/2026-03-09-ux-redesign-design.md`

---

## Phase 1: Data Model (Project entity + schema migration)

### Task 1: Add Project model to Prisma schema

**Files:**
- Modify: `packages/server/prisma/schema.prisma`

**Step 1: Add the Project model after the User model (~line 203)**

```prisma
model Project {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name          String
  repo          String
  branch        String   @default("main")
  devboxId      String?  @map("devbox_id")
  workspacePath String   @map("workspace_path")
  status        String   @default("idle")
  userId        String   @map("user_id")
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt     DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  user    User    @relation(fields: [userId], references: [id])
  threads Thread[]
  issues  Issue[]

  @@map("projects")
}
```

**Step 2: Add `projects Project[]` relation to User model (after `installedPlugins` ~line 200)**

**Step 3: Modify Thread model (~lines 271-296)**

Add new fields:
```prisma
  projectId      String?  @map("project_id") @db.Uuid
  worktreePath   String?  @map("worktree_path")
  worktreeBranch String?  @map("worktree_branch")
```

Add relation:
```prisma
  project Project? @relation(fields: [projectId], references: [id])
```

Keep existing `repo`, `branch`, `devboxId`, `workspacePath` fields for now (will be deprecated gradually, not removed — avoids breaking existing threads).

**Step 4: Modify Issue model (~lines 148-182)**

Add:
```prisma
  projectId String? @map("project_id") @db.Uuid
```

Add relation:
```prisma
  project Project? @relation(fields: [projectId], references: [id])
```

Keep existing `repo`, `branch` for backward compatibility.

**Step 5: Run migration**

```bash
cd packages/server && npx prisma migrate dev --name add_project_model
```

**Step 6: Verify Prisma client generates**

```bash
npx prisma generate
```

**Step 7: Commit**

```bash
git add packages/server/prisma/
git commit -m "feat: add Project model with thread and issue relations"
```

---

### Task 2: Create Projects API router

**Files:**
- Create: `packages/server/src/api/projects.ts`
- Modify: `packages/server/src/index.ts`

**Step 1: Create the projects router**

Create `packages/server/src/api/projects.ts`:

```typescript
import { Router } from "express";
import prisma from "../db/prisma.js";
import { existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const PROJECTS_DIR = process.env.PROJECTS_DIR || "/data/patchwork/projects";

export function projectsRouter() {
  const r = Router();

  // List user's projects
  r.get("/", async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const projects = await prisma.project.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      include: {
        _count: { select: { threads: true, issues: true } },
      },
    });
    res.json(projects);
  });

  // Get single project with threads and issues
  r.get("/:id", async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const project = await prisma.project.findFirst({
      where: { id: req.params.id, userId },
      include: {
        threads: {
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            title: true,
            status: true,
            provider: true,
            model: true,
            worktreeBranch: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        issues: {
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            identifier: true,
            title: true,
            status: true,
            priority: true,
            labels: true,
          },
        },
      },
    });
    if (!project) return res.status(404).json({ error: "Not found" });
    res.json(project);
  });

  // Create project (clone repo into project workspace)
  r.post("/", async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { name, repo, branch = "main" } = req.body;
    if (!name || !repo) {
      return res.status(400).json({ error: "name and repo are required" });
    }

    // Resolve GitHub token
    const account = await prisma.account.findFirst({
      where: { userId, providerId: "github" },
    });
    const githubToken = account?.accessToken;

    // Create project directory
    const projectId = crypto.randomUUID();
    const projectDir = `${PROJECTS_DIR}/${projectId}`;
    const repoDir = `${projectDir}/repo`;
    if (!existsSync(PROJECTS_DIR)) mkdirSync(PROJECTS_DIR, { recursive: true });
    mkdirSync(repoDir, { recursive: true });

    // Clone repo
    const cloneUrl = githubToken
      ? `https://x-access-token:${githubToken}@github.com/${repo}.git`
      : `https://github.com/${repo}.git`;

    try {
      execFileSync("git", ["clone", "--branch", branch, "--single-branch", cloneUrl, repoDir], {
        stdio: "pipe",
        timeout: 120000,
      });
    } catch (err: any) {
      return res.status(500).json({
        error: `git clone failed: ${err.stderr?.toString() || err.message}`,
      });
    }

    // Set git author from user profile
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user?.name) {
        execFileSync("git", ["config", "user.name", user.name], { cwd: repoDir });
      }
      if (user?.email) {
        execFileSync("git", ["config", "user.email", user.email], { cwd: repoDir });
      }
    } catch {}

    const project = await prisma.project.create({
      data: {
        id: projectId,
        name,
        repo,
        branch,
        workspacePath: repoDir,
        userId,
      },
    });

    res.status(201).json(project);
  });

  // Delete project
  r.delete("/:id", async (req, res) => {
    const userId = (req as any).user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const project = await prisma.project.findFirst({
      where: { id: req.params.id, userId },
    });
    if (!project) return res.status(404).json({ error: "Not found" });

    // Delete all threads first (cascading)
    await prisma.thread.deleteMany({ where: { projectId: project.id } });
    await prisma.issue.updateMany({
      where: { projectId: project.id },
      data: { projectId: null },
    });
    await prisma.project.delete({ where: { id: project.id } });

    // Clean up filesystem
    const { rmSync } = await import("node:fs");
    const projectDir = `${PROJECTS_DIR}/${project.id}`;
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {}

    res.status(204).end();
  });

  return r;
}
```

**Step 2: Register the router in `packages/server/src/index.ts`**

Add import: `import { projectsRouter } from "./api/projects.js";`
Add registration: `app.use("/api/projects", projectsRouter);` (after the plugins line)

**Step 3: Type-check**

```bash
cd packages/server && node_modules/.bin/tsc --noEmit
```

**Step 4: Commit**

```bash
git add packages/server/src/api/projects.ts packages/server/src/index.ts
git commit -m "feat: add projects API with CRUD and git clone"
```

---

### Task 3: Add worktree management to thread creation

**Files:**
- Create: `packages/server/src/git/worktree.ts`
- Modify: `packages/server/src/api/threads.ts`

**Step 1: Create worktree utility**

Create `packages/server/src/git/worktree.ts`:

```typescript
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

export function createWorktree(opts: {
  repoDir: string;
  worktreeDir: string;
  branch: string;
  baseBranch?: string;
}): void {
  const { repoDir, worktreeDir, branch, baseBranch } = opts;
  const parentDir = worktreeDir.substring(0, worktreeDir.lastIndexOf("/"));
  if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });

  const args = ["worktree", "add", worktreeDir, "-b", branch];
  if (baseBranch) args.push(baseBranch);

  execFileSync("git", args, { cwd: repoDir, stdio: "pipe", timeout: 30000 });
}

export function removeWorktree(repoDir: string, worktreeDir: string): void {
  try {
    execFileSync("git", ["worktree", "remove", worktreeDir, "--force"], {
      cwd: repoDir,
      stdio: "pipe",
      timeout: 15000,
    });
  } catch {
    // Worktree may already be gone
  }
}

export function listWorktrees(repoDir: string): string[] {
  try {
    const out = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: repoDir,
      encoding: "utf-8",
      timeout: 10000,
    });
    return out
      .split("\n")
      .filter((l) => l.startsWith("worktree "))
      .map((l) => l.replace("worktree ", ""));
  } catch {
    return [];
  }
}
```

**Step 2: Modify thread creation in `packages/server/src/api/threads.ts`**

In the POST `/` handler, after resolving the project (add project lookup):

- If `req.body.projectId` is set, look up the project
- If `req.body.worktreeBranch` is set, create a worktree under the project
- Set thread's `worktreePath` and `worktreeBranch`
- Use worktree path (or project root) as the workspace for the Claude session

In the DELETE `/:id` handler:
- If thread has `worktreePath`, call `removeWorktree`

**Step 3: Type-check and commit**

```bash
cd packages/server && node_modules/.bin/tsc --noEmit
git add packages/server/src/git/worktree.ts packages/server/src/api/threads.ts
git commit -m "feat: add git worktree management for per-thread isolation"
```

---

### Task 4: Add project types and API methods to UI client

**Files:**
- Modify: `packages/ui/src/lib/api.ts`

**Step 1: Add types**

```typescript
export interface ProjectItem {
  id: string;
  name: string;
  repo: string;
  branch: string;
  status: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  _count?: { threads: number; issues: number };
}

export interface ProjectDetail extends ProjectItem {
  threads: Array<{
    id: string;
    title: string;
    status: string;
    provider: string;
    model: string | null;
    worktreeBranch: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  issues: Array<{
    id: string;
    identifier: string;
    title: string;
    status: string;
    priority: number;
    labels: string[];
  }>;
}

export interface CreateProjectRequest {
  name: string;
  repo: string;
  branch?: string;
}
```

**Step 2: Add API methods to PatchworkAPI class**

```typescript
  // Projects
  async listProjects(): Promise<ProjectItem[]> {
    return request<ProjectItem[]>("/api/projects");
  }

  async getProject(id: string): Promise<ProjectDetail> {
    return request<ProjectDetail>(`/api/projects/${id}`);
  }

  async createProject(input: CreateProjectRequest): Promise<ProjectItem> {
    return request<ProjectItem>("/api/projects", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async deleteProject(id: string): Promise<void> {
    return request<void>(`/api/projects/${id}`, { method: "DELETE" });
  }
```

**Step 3: Update `createThread` to accept `projectId` and `worktreeBranch`**

Add to the existing `createThread` method's data parameter:
```typescript
  projectId?: string;
  worktreeBranch?: string;
```

**Step 4: Commit**

```bash
git add packages/ui/src/lib/api.ts
git commit -m "feat: add project types and API client methods"
```

---

## Phase 2: UI Navigation Redesign

### Task 5: Create Top Bar component

**Files:**
- Create: `packages/ui/src/components/top-bar.tsx`

**Step 1: Create the top bar**

A horizontal nav bar with: Logo, page links (Board, Plugins, Settings), Cmd+K trigger, user avatar dropdown. Use the same zinc/neutral palette from t3code — `bg-zinc-950 border-zinc-800` style. Height 48px. Active page link gets `bg-zinc-800/50` highlight.

The avatar dropdown reuses the same GitHub profile + sign out pattern from the current nav.tsx.

**Step 2: Commit**

```bash
git add packages/ui/src/components/top-bar.tsx
git commit -m "feat: add top bar navigation component"
```

---

### Task 6: Create Project Sidebar component

**Files:**
- Create: `packages/ui/src/components/project-sidebar.tsx`

**Step 1: Create the sidebar**

A left sidebar (~260px, collapsible) that shows:
- "< All Projects" back link at top
- Project name + repo + status badge
- "+ New thread" button
- Thread list with status dots (green=active, gray=idle, amber=pending)
- Worktree branch badges on applicable threads
- Issues section at bottom

Thread status dots should use subtle pulse animation for active state.

The sidebar fetches project data via `api.getProject(projectId)` and auto-refreshes every 3 seconds (like the current board).

**Step 2: Commit**

```bash
git add packages/ui/src/components/project-sidebar.tsx
git commit -m "feat: add project sidebar with thread list and status indicators"
```

---

### Task 7: Create Command Palette component

**Files:**
- Create: `packages/ui/src/components/command-palette.tsx`
- Create: `packages/ui/src/hooks/use-command-palette.ts`

**Step 1: Create the hook**

`useCommandPalette` manages:
- `open` state (boolean)
- `commands` registry (array of `{ id, label, group, shortcut?, icon?, onSelect, available? }`)
- `registerCommand` / `unregisterCommand` functions
- Global Cmd+K listener

**Step 2: Create the component**

Centered modal overlay with:
- Search input (autofocused, debounced 150ms)
- Grouped results (Navigation, Actions)
- Keyboard nav: arrow keys to move, Enter to select, Escape to close
- Fuzzy matching via simple substring match (no external lib)
- Shortcut hints on right side
- Recent commands at top (stored in localStorage)

Visual style: `bg-zinc-900 border-zinc-700`, rounded-xl, shadow-2xl, max-h 400px with scroll.

**Step 3: Commit**

```bash
git add packages/ui/src/components/command-palette.tsx packages/ui/src/hooks/use-command-palette.ts
git commit -m "feat: add Cmd+K command palette with fuzzy search"
```

---

### Task 8: Rewire Shell layout and routing

**Files:**
- Modify: `packages/ui/src/components/shell.tsx`
- Modify: `packages/ui/src/components/nav.tsx` (deprecate or remove)
- Create: `packages/ui/src/app/projects/layout.tsx`
- Create: `packages/ui/src/app/projects/page.tsx`
- Create: `packages/ui/src/app/projects/new/page.tsx`
- Create: `packages/ui/src/app/projects/[projectId]/layout.tsx`
- Create: `packages/ui/src/app/projects/[projectId]/page.tsx`
- Create: `packages/ui/src/app/projects/[projectId]/threads/[id]/page.tsx`

**Step 1: Update Shell to use TopBar instead of Nav sidebar**

Replace the flex-row layout (sidebar + content) with:
- TopBar at top (fixed)
- CommandPalette rendered at root level
- Main content below (full width, or with sidebar depending on route)

**Step 2: Create project route pages**

- `/projects/page.tsx` — Project list (cards with name, repo, thread count, status)
- `/projects/new/page.tsx` — Create project form (name, repo picker from GitHub, branch)
- `/projects/[projectId]/layout.tsx` — Wraps project views with ProjectSidebar
- `/projects/[projectId]/page.tsx` — Empty state or redirects to first thread
- `/projects/[projectId]/threads/[id]/page.tsx` — Thread detail (reuse existing thread page with projectId context)

**Step 3: Update Board page**

Modify `packages/ui/src/app/board/page.tsx`:
- Issue creation form: replace repo field with project selector
- Kanban cards: show project name, live thread status, PR badge
- Card click: navigate to `/projects/[projectId]/threads/[threadId]`

**Step 4: Type-check and commit**

```bash
cd packages/ui && npx next build
git add packages/ui/src/
git commit -m "feat: rewire navigation to top bar + project sidebar layout"
```

---

## Phase 3: Thread Enhancements

### Task 9: Update thread creation for project context

**Files:**
- Create: `packages/ui/src/app/projects/[projectId]/threads/new/page.tsx`
- Modify: `packages/server/src/api/threads.ts`

**Step 1: Create new thread creation page within project context**

Form fields:
- Title (required)
- Environment: radio — "Local (project root)" vs "New worktree"
- Branch: text input or selector (for worktree mode)
- Model: dropdown (claude-opus-4-6 default)
- Mode: radio (approval-required / full-access)

On submit: POST to `/api/threads` with `projectId` and optional `worktreeBranch`.

**Step 2: Update server thread creation to handle worktrees**

When `projectId` + `worktreeBranch` are provided:
1. Look up the project
2. Create worktree: `git worktree add <projectDir>/worktrees/<shortId> -b <branch>`
3. Store `worktreePath` and `worktreeBranch` on the thread
4. Use worktree path as `workspacePath` for the Claude session

**Step 3: Commit**

```bash
git add packages/ui/src/app/projects/ packages/server/src/api/threads.ts
git commit -m "feat: thread creation with project context and worktree support"
```

---

### Task 10: PR creation per thread

**Files:**
- Create: `packages/server/src/git/pr.ts`
- Modify: `packages/server/src/api/threads.ts`
- Modify: `packages/ui/src/lib/api.ts`

**Step 1: Create PR utility**

`packages/server/src/git/pr.ts`:
- `commitAndPush(opts)`: stages all changes, commits with user identity, pushes
- `createPR(opts)`: uses `gh pr create` CLI with user's GitHub token
- Combined `commitPushAndCreatePR(opts)`: full pipeline

Uses `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` env vars from user profile.

**Step 2: Add PR endpoint to threads router**

`POST /api/threads/:id/pr`:
1. Look up thread + project
2. Determine workspace (worktreePath or project root)
3. Call `commitPushAndCreatePR` with user identity
4. Return `{ prUrl, prNumber, branch }`

**Step 3: Add "Merge All PRs" endpoint to projects router**

`POST /api/projects/:id/merge-prs`:
1. Find all threads with open PRs in the project
2. Create integration branch from project default branch
3. Merge each thread branch
4. Push and create combined PR

**Step 4: Add API methods to UI client**

**Step 5: Commit**

```bash
git add packages/server/src/git/pr.ts packages/server/src/api/threads.ts packages/server/src/api/projects.ts packages/ui/src/lib/api.ts
git commit -m "feat: per-thread PR creation and merge-all-PRs flow"
```

---

## Phase 4: Board Integration

### Task 11: Issue dispatch creates thread with worktree

**Files:**
- Modify: `packages/server/src/api/issues.ts`

**Step 1: Update issue dispatch endpoint**

When an issue is dispatched (POST `/api/issues/:id/dispatch`):
1. Issue must have `projectId`
2. Create worktree branch: `thread/issue-<identifier>`
3. Create Thread under the project with worktree
4. Auto-send first turn with issue body as the user message
5. Update issue status to "in_progress"
6. Return the created thread

**Step 2: Commit**

```bash
git add packages/server/src/api/issues.ts
git commit -m "feat: issue dispatch auto-creates worktree thread"
```

---

### Task 12: Enhanced Board kanban cards

**Files:**
- Modify: `packages/ui/src/app/board/page.tsx`

**Step 1: Update kanban cards**

- Show project name instead of raw repo
- Add live status dot from associated thread (via polling or WebSocket)
- Add PR badge when thread has open PR
- Click card → navigate to `/projects/[projectId]/threads/[threadId]`
- Add project filter dropdown at top of board

**Step 2: Commit**

```bash
git add packages/ui/src/app/board/page.tsx
git commit -m "feat: enhanced board cards with live thread status and PR badges"
```

---

## Phase 5: Keyboard Shortcuts

### Task 13: Comprehensive keyboard shortcuts

**Files:**
- Modify: `packages/ui/src/hooks/use-keyboard-shortcuts.ts`
- Modify: `packages/ui/src/components/command-palette.tsx`

**Step 1: Extend keyboard shortcuts hook**

Add all shortcuts from design:
- Global: Cmd+K, Cmd+B, Cmd+N, Cmd+Shift+N, Cmd+1-9, Escape
- Thread: Cmd+D, Cmd+J, Cmd+Enter, Cmd+Shift+P, Cmd+., Cmd+Shift+.
- Board: Cmd+I, arrow navigation, Enter, D

Shortcuts dispatch custom events, consumed by relevant page components.

**Step 2: Register action commands in command palette**

Wire up action commands: New Thread, New Project, New Issue, Toggle Diff, Toggle Terminal, Stop Thread, Create PR, etc.

**Step 3: Commit**

```bash
git add packages/ui/src/hooks/use-keyboard-shortcuts.ts packages/ui/src/components/command-palette.tsx
git commit -m "feat: comprehensive keyboard shortcuts and command palette actions"
```

---

## Phase 6: Polish & Quality

### Task 14: Skeleton loaders and transitions

**Files:**
- Create: `packages/ui/src/components/ui/skeleton.tsx`
- Modify: various page components

**Step 1: Create skeleton component**

Shimmer animation loader matching the zinc palette. Reusable for cards, thread lists, timeline.

**Step 2: Add skeletons to all loading states**

- Project list: card skeletons
- Thread sidebar: list item skeletons
- Board: kanban card skeletons
- Thread detail: timeline skeletons

**Step 3: Add transitions**

- Sidebar expand/collapse: 150ms ease-out width transition
- Panel toggle (diff, terminal): 150ms ease-out
- Page transitions: fade-in 100ms

**Step 4: Commit**

```bash
git add packages/ui/src/components/
git commit -m "feat: skeleton loaders and smooth transitions"
```

---

### Task 15: Toast notifications

**Files:**
- Create: `packages/ui/src/components/ui/toast.tsx`
- Create: `packages/ui/src/hooks/use-toast.ts`

**Step 1: Create toast system**

Lightweight toast component (no external lib):
- Positioned bottom-right
- Auto-dismiss after 4 seconds
- Types: success (green), error (red), info (zinc), progress (with stages)
- Used for: PR creation progress, issue dispatch, thread creation, errors

**Step 2: Commit**

```bash
git add packages/ui/src/components/ui/toast.tsx packages/ui/src/hooks/use-toast.ts
git commit -m "feat: toast notification system"
```

---

### Task 16: Final integration, cleanup, and redirects

**Files:**
- Modify: `packages/ui/src/app/threads/page.tsx` (add redirect)
- Modify: `packages/ui/src/app/threads/[id]/page.tsx` (add redirect)
- Remove or redirect: old thread routes that are superseded
- Modify: `packages/ui/src/components/nav.tsx` (remove or keep as fallback)

**Step 1: Add redirects from old routes**

- `/threads` → `/projects` (or last active project)
- `/threads/[id]` → look up thread's project, redirect to `/projects/[projectId]/threads/[id]`
- `/threads/new` → redirect to `/projects`

**Step 2: Clean up unused imports and dead code**

**Step 3: Full build verification**

```bash
cd packages/server && node_modules/.bin/tsc --noEmit
cd packages/ui && npx next build
```

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete UX redesign with project-centric navigation"
```

**Step 5: Push to remote**

```bash
git push origin master
```

---

## Execution Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1 | 1-4 | Data model: Project entity, schema migration, API, UI types |
| 2 | 5-8 | Navigation: Top bar, project sidebar, command palette, routing |
| 3 | 9-10 | Threads: Worktree creation flow, PR creation |
| 4 | 11-12 | Board: Issue dispatch, enhanced kanban cards |
| 5 | 13 | Keyboard: Comprehensive shortcuts |
| 6 | 14-16 | Polish: Skeletons, toasts, redirects, cleanup |

Each phase produces a working, committable state. Phases can be executed sequentially with review checkpoints between them.
