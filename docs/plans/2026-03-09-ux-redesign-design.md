# UX Redesign: Project-Centric Multi-Session Architecture

**Date**: 2026-03-09
**Status**: Approved

## Summary

Redesign Patchwork's UX around a project-centric model inspired by t3code. Projects (devbox + repo) become the primary organizing entity. Each project contains multiple threads, each with an optional git worktree for isolated parallel work. Board issues belong to projects and auto-create threads when dispatched. Navigation moves to a top bar with a contextual left sidebar. A Cmd+K command palette provides fast keyboard-driven access to all navigation and actions.

## Decisions

- **Hierarchy**: Project (devbox + repo) → Threads (each with optional worktree)
- **Issues**: Belong to a project; dispatch creates a thread under that project with its own worktree
- **Navigation**: Top bar for global nav (Board, Plugins, Settings), left sidebar for project/thread context
- **Command Palette**: Moderate scope — navigation + common actions, polished production feel
- **PR Authorship**: User's GitHub identity for all commits and PRs (GIT_AUTHOR_NAME/EMAIL injected)
- **Architecture**: Approach 1 — Thread = Chat, Project = Container (matches t3code's proven model)

## Section 1: Data Model

### New: Project model

```
Project
  id            UUID (PK)
  name          String (e.g. "my-app")
  repo          String (e.g. "owner/repo")
  branch        String (default branch, e.g. "main")
  devboxId      String? (container ID when running)
  workspacePath String (host path to cloned repo)
  status        "active" | "idle" | "error"
  userId        String (FK -> User)
  createdAt     DateTime
  updatedAt     DateTime
```

### Modified: Thread

- ADD `projectId` (FK -> Project, required)
- ADD `worktreePath` (String?, null = uses project root)
- ADD `worktreeBranch` (String?, branch name for this worktree)
- REMOVE `repo`, `branch`, `workspacePath`, `devboxId` (live on Project now)

### Modified: IssueItem

- ADD `projectId` (FK -> Project, required)
- REMOVE `repo`, `branch` (live on Project now)

### Relationships

```
User --< Project --< Thread (each with optional worktree)
                 --< Issue  (dispatched -> creates Thread)
```

### Worktree Lifecycle

- Thread created with worktree mode -> `git worktree add ../worktrees/<threadId> -b <branch>`
- Thread workspace = worktreePath ?? project.workspacePath
- Thread deleted -> `git worktree remove <path>`
- Project deleted -> all worktrees cleaned up, devbox destroyed

## Section 2: Navigation & Layout

### Top Bar (replaces left sidebar for global nav)

```
[P] Patchwork    Board  Plugins  Settings    Cmd+K    [avatar]
```

- Left: Logo + app name
- Center-left: Page links (Board, Plugins, Settings)
- Center-right: Cmd+K trigger button
- Right: User avatar with dropdown (GitHub profile, Sign out)
- Height: 48px

### Left Sidebar (contextual, project/thread views only)

- Shows when viewing a project or thread
- Contains: project name, thread list (with status dots), issue list
- Width: ~260px, collapsible (Cmd+B)
- Threads sorted by status: active first, then idle
- Each thread shows: status dot, title, worktree branch badge, PR badge

### Board View

- Full-width kanban, no sidebar
- Cards show project name, live thread status, PR badges
- Click card -> navigates to project sidebar + issue thread

### Thread Detail

- Three-pane: sidebar (left) + timeline (center) + diff panel (right, toggleable)
- Terminal drawer at bottom (toggleable)
- Composer at bottom of timeline

## Section 3: Command Palette (Cmd+K)

- Centered modal overlay, ~500px wide
- Fuzzy search, debounced 150ms, keyboard navigation
- Two groups: Navigation (go to pages/entities) and Actions (create, toggle, stop, etc.)
- Context-aware: only shows relevant actions
- Shortcut hints displayed on right side
- Recently used commands float to top
- Custom implementation, no external library

## Section 4: Worktrees & Multi-Session

### Thread Creation

- Environment toggle: Local (project root) vs New worktree
- Worktree mode creates isolated filesystem via `git worktree add`
- Environment mode locks after first message
- Quick-create (Cmd+N) defaults to worktree with auto-generated branch

### Directory Structure

```
/data/patchwork/projects/<projectId>/
  repo/                     <- main clone
  worktrees/
    <threadId-short>/       <- per-thread worktrees
```

### Multiple Active Sessions

- Each thread can run its own Claude Code session simultaneously
- Sidebar shows live status for ALL threads
- Switching threads changes view, background sessions keep running
- WebSocket multiplexes events tagged by threadId

### PR Creation

Per-thread: commit -> push -> `gh pr create` with user's GitHub identity.
Progress shown as toast stages.

"Merge All PRs" button: creates integration branch, merges all thread branches, creates combined PR. Shows conflict errors if any.

## Section 5: Board <-> Thread Integration

### Issue Lifecycle

1. Issue created on Board, assigned to Project
2. Issue dispatched -> creates worktree thread, auto-starts with issue body
3. Kanban card shows live thread status (pulse animation)
4. Thread completes -> auto-creates PR, issue moves to "Review"
5. PR merged -> issue moves to "Done", worktree cleaned up

### Enhanced Kanban Cards

- Show project name + branch
- Live status dot from thread (working/pending/idle/error)
- Activity indicator (tool calls, message count)
- PR badge with link
- Click -> navigates to project + thread view

## Section 6: Keyboard Shortcuts

### Global

| Shortcut | Action |
|----------|--------|
| Cmd+K | Command palette |
| Cmd+B | Toggle sidebar |
| Cmd+N | New thread |
| Cmd+Shift+N | New project |
| Cmd+1-9 | Switch to thread 1-9 |
| Escape | Close/dismiss |

### Thread View

| Shortcut | Action |
|----------|--------|
| Cmd+D | Toggle diff |
| Cmd+J | Toggle terminal |
| Cmd+Enter | Send message |
| Cmd+Shift+P | Create PR |
| Cmd+. | Approve request |
| Cmd+Shift+. | Deny request |

### Board View

| Shortcut | Action |
|----------|--------|
| Cmd+I | New issue |
| Arrows | Navigate cards |
| Enter | Open card |
| D | Dispatch issue |

## Section 7: Routing

### URL Structure

```
/board                              -> Kanban (full-width)
/projects                           -> Project list
/projects/new                       -> Create project
/projects/[projectId]               -> Project view + sidebar
/projects/[projectId]/threads/[id]  -> Thread detail
/plugins                            -> Plugin marketplace
/settings                           -> Settings
/login                              -> Auth
```

### Migration

- /threads -> redirect to /projects/[lastProjectId]
- /threads/[id] -> redirect to /projects/[projectId]/threads/[id]
- /runs, /templates, /blueprints -> accessible via Cmd+K or Settings

## UI/UX Quality Standards

- Skeleton loaders (shimmer) instead of blank screens
- Optimistic UI for all mutations
- Pulse/breathing animations on active status dots
- 150ms ease-out transitions on panel toggle
- Toast notifications for background events
- Neutral zinc palette, subtle borders, hover lift
- No dead silence — always show activity state
