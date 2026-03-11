# Agent Teams Design Spec

## Goal

Replicate the Claude Code experimental agent teams tmux experience in Patchwork's web UI. Users create a team of independent agents within a project, see them all in a CSS grid of split panes, and chat directly with each one. Agents communicate via inter-agent messaging and coordinate through a shared task list.

## Background

Claude Code's `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=true` feature lets users run multiple independent Claude sessions in tmux panes. Each teammate has its own context window, can message other teammates, and coordinates via a shared task list. The user interacts directly with each agent — no main orchestrator.

Patchwork already sets the `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` env flag on agent sessions but doesn't use any teams functionality. This design adds full teams support.

### Key Differences from Subagents

| Aspect | Subagents (existing) | Agent Teams (new) |
|--------|---------------------|-------------------|
| Context | Share lead's context | Own independent context windows |
| Communication | Only report back to lead | Message each other directly |
| Coordination | Lead manages all work | Shared task list + self-coordination |
| User interaction | User talks to lead only | User talks to each agent directly |
| Lifecycle | Ephemeral, die when done | Persistent sessions like threads |

---

## Data Model

### New Tables

**Team** — A named group of threads that share a task list and can message each other.

```
Team
  id          UUID (PK)
  name        string              — e.g. "Review PR #142"
  projectId   UUID (FK → Project)
  userId      string (FK → User)
  status      "active" | "idle" | "archived"
  createdAt   DateTime
  updatedAt   DateTime
```

**TeamMember** — Links a thread to a team with a role and display name.

```
TeamMember
  id          UUID (PK)
  teamId      UUID (FK → Team, cascade delete)
  threadId    UUID (FK → Thread)
  role        "lead" | "teammate"
  name        string              — display name, e.g. "security-reviewer"

  Unique: (teamId, threadId)
```

**TeamMessage** — Inter-agent messages within a team.

```
TeamMessage
  id            UUID (PK)
  teamId        UUID (FK → Team, cascade delete)
  fromThreadId  UUID (FK → Thread)
  toThreadId    UUID? (FK → Thread)   — null = broadcast
  content       string
  createdAt     DateTime
```

### Modified Tables

**Thread** — Add optional team association.

```
Thread (add field)
  teamId      UUID? (FK → Team)     — null for standalone threads
```

### Shared Task List

No new table. Reuses existing `TodoWrite` tracking per-thread. Tasks from all team member threads are aggregated via the API.

---

## Team Lifecycle

### Creation

1. User clicks "New Team" from project sidebar or Cmd+K
2. Dialog: team name, number of agents (1-6, default 3), agent names, runtime mode, optional initial prompt
3. Server creates Team row
4. Server creates N Thread rows, each with `teamId` set, each gets its own git worktree
5. Server starts N independent agent sessions via `providerService.createThread()` (batched)
6. First thread gets `role: "lead"`, rest get `role: "teammate"`
7. If initial prompt provided, broadcast as first user turn to all agents

### Shutdown

Stopping a team stops all member sessions. Each thread transitions to `status: "idle"`.

### Archiving

Archiving a team sets `team.status = "archived"` and archives all member threads (`archivedAt = now()`).

---

## API Endpoints

```
POST   /api/projects/:projectId/teams           — Create team + spawn member threads
GET    /api/projects/:projectId/teams           — List teams for project
GET    /api/teams/:teamId                       — Get team with members + thread status
DELETE /api/teams/:teamId                       — Archive team and all members
POST   /api/teams/:teamId/messages              — Send inter-agent message (or user message)
GET    /api/teams/:teamId/messages              — Get message history
GET    /api/teams/:teamId/tasks                 — Aggregated todos from all member threads
POST   /api/teams/:teamId/stop                  — Stop all member sessions
```

---

## Inter-Agent Messaging

### Flow

1. Agent A calls `SendMessage` tool with `{ teammate_name, content }`
2. Adapter message loop detects `SendMessage` tool_use block
3. Resolves target thread via `TeamMember.name` lookup
4. Writes to `team_messages` table
5. Server emits `team.message.received` event to target thread's WebSocket clients
6. On target agent's next turn, message is prepended as context:
   `"[Message from security-reviewer]: I found a vulnerability in auth.ts line 42"`

### Adapter Changes

In the Claude Code adapter's message processing loop:
- Detect `SendMessage` tool_use blocks (same pattern as `TodoWrite` and `AskUserQuestion` detection)
- Look up the team via the session's `teamId`
- Resolve target teammate by name from `TeamMember` table
- Write `TeamMessage` row and emit WebSocket event

---

## UI: Team View

### Route

`/projects/[projectId]/teams/[teamId]`

### Layout

```
┌──────────────────────────────────────────────────────────┐
│ Team Header: name | N agents | Stop All | Archive        │
├────────────────────┬────────────────────┬────────────────┤
│ agent-1 (lead)     │ agent-2            │ agent-3        │
│ ● active           │ ● active           │ ○ idle         │
│ ──────────────     │ ──────────────     │ ──────────────│
│ [timeline scroll]  │ [timeline scroll]  │ [timeline]     │
│                    │                    │                │
│ ──────────────     │ ──────────────     │ ──────────────│
│ [composer input]   │ [composer input]   │ [composer]     │
├────────────────────┴────────────────────┴────────────────┤
│ Team Activity Bar (collapsible)                          │
│ agent-1 → agent-2: "Found SQL injection in auth.ts"     │
│ task: "Review auth module" completed by agent-1          │
└──────────────────────────────────────────────────────────┘
```

### Grid Tiling

Auto-tiles based on teammate count (like tmux):
- 1: 1 column
- 2: 2 columns
- 3: 3 columns
- 4: 2x2 grid
- 5-6: 3x2 grid

### Focused Pane

- Click a pane to focus it — highlight border (like tmux active pane)
- Keyboard input goes to focused pane's composer
- `Tab` / `Shift+Tab` cycles focus
- `Cmd+1-9` focuses pane by number

### Pane Contents

Each pane is a slimmed-down thread detail:
- Agent name + status indicator (header)
- Timeline (scrollable) — streaming text, work items, approvals
- Composer input — send messages to this specific agent

No diff panel or terminal inside panes (too cramped). Shared diff panel toggled with `Cmd+D` shows the focused pane's diffs.

### Team Activity Bar

Collapsible bar at the bottom showing:
- Inter-agent messages (from `team_messages`)
- Shared task completions (aggregated todos)
- Live feed of team coordination activity

### Keyboard Shortcuts

- `Tab` / `Shift+Tab` — Cycle focus between panes
- `Cmd+1-9` — Focus pane by number
- `Cmd+Shift+S` — Stop all agents
- `Cmd+D` — Toggle shared diff panel (focused agent's diffs)

---

## WebSocket & Event Streaming

### Connection Model

One WebSocket per team member thread — same as existing threads. The team view opens N connections simultaneously using the existing `useThreadSocket` hook, one per pane. No new WebSocket endpoint needed.

### New Events (on existing thread WebSocket)

```
team.message.received
  { fromThreadId, fromName, content, teamId }

team.task.updated
  { taskId, status, ownedBy, content }
```

Emitted by the server when a `TeamMessage` is created or a todo changes, fan-out to all threads in the team.

---

## Project Sidebar Integration

### Teams Section

Add between THREADS and ISSUES:

```
THREADS
├─ Thread 1 (standalone)
├─ Thread 2 (standalone)

TEAMS
├─ Review PR #142 (3 agents) ● active
├─ Refactor auth (2 agents) ○ idle

ISSUES (4)
├─ [PWK-12] Fix login bug
```

Team member threads are hidden from the THREADS list to prevent clutter.

### New Team Dialog

- Team name (required)
- Number of agents (1-6, default 3)
- Agent names (auto-filled: agent-1, agent-2, etc. — editable)
- Runtime mode: approval-required / full-access (applies to all members)
- Optional: initial prompt broadcast to all agents

### Command Palette

- "New Team" action
- Teams listed as navigable items
- "Switch to [team-name]" commands

---

## Files to Create/Modify

### New Files
- `packages/server/prisma/` — Schema additions (Team, TeamMember, TeamMessage)
- `packages/server/src/api/teams.ts` — Team CRUD + messaging API
- `packages/ui/src/app/projects/[projectId]/teams/[teamId]/page.tsx` — Team grid view
- `packages/ui/src/components/team/team-pane.tsx` — Single agent pane component
- `packages/ui/src/components/team/team-activity-bar.tsx` — Activity feed
- `packages/ui/src/components/team/new-team-dialog.tsx` — Creation dialog

### Modified Files
- `packages/server/src/providers/claude-code/adapter.ts` — SendMessage interception
- `packages/server/src/providers/events.ts` — New event types
- `packages/server/src/providers/service.ts` — Team-aware thread creation
- `packages/server/src/api/index.ts` — Mount teams router
- `packages/ui/src/components/project-sidebar.tsx` — Teams section
- `packages/ui/src/components/command-palette.tsx` — Team commands
- `packages/ui/src/hooks/use-global-shortcuts.ts` — Team keyboard shortcuts
- `packages/ui/src/lib/api.ts` — Team API client methods
