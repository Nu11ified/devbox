# Agent Teams Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replicate the Claude Code experimental agent teams tmux experience in Patchwork's web UI — split-pane grid of independent agents with shared task list and inter-agent messaging.

**Architecture:** New Team/TeamMember/TeamMessage tables link multiple threads into a team. A new team grid view renders N concurrent thread panes using CSS grid. The existing `useThreadSocket` hook is reused per-pane — no new WebSocket endpoint. The Claude Code adapter intercepts `SendMessage` tool_use blocks and routes them to the target teammate thread.

**Tech Stack:** Prisma (schema), Express (API), Next.js App Router (team view page), CSS Grid (pane layout), existing WebSocket fan-out system.

**Spec:** `docs/superpowers/specs/2026-03-11-agent-teams-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/server/src/api/teams.ts` | Team CRUD, messaging, task aggregation REST API |
| `packages/ui/src/app/projects/[projectId]/teams/[teamId]/page.tsx` | Team grid view page — CSS grid of thread panes |
| `packages/ui/src/components/team/team-pane.tsx` | Single agent pane (mini timeline + composer) |
| `packages/ui/src/components/team/team-activity-bar.tsx` | Collapsible team coordination feed |
| `packages/ui/src/components/team/new-team-dialog.tsx` | Team creation dialog |

### Modified Files

| File | Changes |
|------|---------|
| `packages/server/prisma/schema.prisma` | Add Team, TeamMember, TeamMessage models; add `teamId` to Thread |
| `packages/server/src/index.ts` | Mount `teamsRouter` at `/api/teams` and `/api/projects/:projectId/teams` |
| `packages/server/src/providers/claude-code/adapter.ts` | Detect `SendMessage` tool_use, route to target teammate |
| `packages/server/src/providers/events.ts` | Add `team.message.received` and `team.task.updated` event types |
| `packages/server/src/api/thread-ws.ts` | Emit team events to all team member WebSocket connections |
| `packages/ui/src/lib/api.ts` | Add team API client types and methods |
| `packages/ui/src/components/project-sidebar.tsx` | Add TEAMS section, hide team threads from THREADS list |
| `packages/ui/src/components/command-palette.tsx` | Add team navigation commands |
| `packages/ui/src/hooks/use-global-shortcuts.ts` | Add team keyboard shortcuts |

---

## Chunk 1: Data Model & Schema

### Task 1: Add Team, TeamMember, TeamMessage to Prisma schema

**Files:**
- Modify: `packages/server/prisma/schema.prisma:298-328`

- [ ] **Step 1: Add Team model to schema**

Add after the `UserSettings` model (line ~294) and before the `Thread` model:

```prisma
// ─── Agent Teams ──────────────────────────────────────────────────

model Team {
  id          String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  name        String
  projectId   String    @map("project_id") @db.Uuid
  userId      String    @map("user_id")
  status      String    @default("active") // active, idle, archived
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  project     Project   @relation(fields: [projectId], references: [id])
  user        User      @relation(fields: [userId], references: [id])
  members     TeamMember[]
  threads     Thread[]
  messages    TeamMessage[]

  @@index([projectId])
  @@index([userId])
  @@map("teams")
}

model TeamMember {
  id        String  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  teamId    String  @map("team_id") @db.Uuid
  threadId  String  @map("thread_id") @db.Uuid
  role      String  @default("teammate") // lead, teammate
  name      String  // display name, e.g. "security-reviewer"

  team      Team    @relation(fields: [teamId], references: [id], onDelete: Cascade)
  thread    Thread  @relation(fields: [threadId], references: [id], onDelete: Cascade)

  @@unique([teamId, threadId])
  @@index([teamId])
  @@map("team_members")
}

model TeamMessage {
  id            String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  teamId        String    @map("team_id") @db.Uuid
  fromThreadId  String    @map("from_thread_id") @db.Uuid
  toThreadId    String?   @map("to_thread_id") @db.Uuid
  content       String
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz

  team          Team      @relation(fields: [teamId], references: [id], onDelete: Cascade)
  fromThread    Thread    @relation("MessageFrom", fields: [fromThreadId], references: [id])
  toThread      Thread?   @relation("MessageTo", fields: [toThreadId], references: [id])

  @@index([teamId])
  @@map("team_messages")
}
```

- [ ] **Step 2: Add teamId field and relations to Thread model**

In the `Thread` model (line ~298), add `teamId` field and relations:

```prisma
  teamId         String?  @map("team_id") @db.Uuid
```

Add after `project  Project?` relation:

```prisma
  team           Team?          @relation(fields: [teamId], references: [id])
  teamMember     TeamMember[]
  sentMessages   TeamMessage[]  @relation("MessageFrom")
  receivedMessages TeamMessage[] @relation("MessageTo")
```

- [ ] **Step 3: Add `teams` relation to Project model**

Find the `Project` model and add:

```prisma
  teams    Team[]
```

- [ ] **Step 4: Add `teams` relation to User model**

Find the `User` model and add:

```prisma
  teams    Team[]
```

- [ ] **Step 5: Push schema to database**

Run:
```bash
cd packages/server && bun run prisma db push
```

Expected: Schema applied successfully, new tables `teams`, `team_members`, `team_messages` created, `threads` table gets `team_id` column.

- [ ] **Step 6: Regenerate Prisma client**

Run:
```bash
cd packages/server && bun run prisma generate
```

Expected: Prisma Client generated successfully.

- [ ] **Step 7: Commit**

```bash
git add packages/server/prisma/schema.prisma
git commit -m "feat(teams): add Team, TeamMember, TeamMessage schema models"
```

---

### Task 2: Create teams API router

**Files:**
- Create: `packages/server/src/api/teams.ts`
- Modify: `packages/server/src/index.ts:73-76`

- [ ] **Step 1: Create the teams router file**

Create `packages/server/src/api/teams.ts`:

```typescript
import { Router } from "express";
import { Effect } from "effect";
import prisma from "../db/prisma.js";
import type { ProviderService } from "../providers/service.js";
import { ThreadId } from "../providers/types.js";
import type { ProviderKind } from "../providers/types.js";
import type { AuthProxy } from "../auth/proxy.js";
import { createWorktree } from "../git/worktree.js";

export function teamsRouter(providerService: ProviderService, authProxy?: AuthProxy): Router {
  const router = Router({ mergeParams: true });

  // List teams for a project
  // GET /api/projects/:projectId/teams
  router.get("/", async (req, res) => {
    try {
      const { projectId } = req.params;
      if (!projectId) return res.status(400).json({ error: "projectId required" });

      const teams = await prisma.team.findMany({
        where: { projectId, status: { not: "archived" } },
        orderBy: { updatedAt: "desc" },
        include: {
          members: {
            include: {
              thread: { select: { id: true, title: true, status: true } },
            },
          },
        },
      });
      res.json(teams);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get single team with members
  // GET /api/projects/:projectId/teams/:teamId
  router.get("/:teamId", async (req, res) => {
    try {
      const team = await prisma.team.findUnique({
        where: { id: req.params.teamId },
        include: {
          members: {
            include: {
              thread: {
                select: { id: true, title: true, status: true, model: true, runtimeMode: true },
              },
            },
          },
          project: { select: { id: true, name: true, repo: true, branch: true, workspacePath: true } },
        },
      });
      if (!team) return res.status(404).json({ error: "Team not found" });
      res.json(team);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create team + spawn member threads
  // POST /api/projects/:projectId/teams
  // Body: { name, agentCount, agentNames?, runtimeMode?, initialPrompt?, provider?, model? }
  router.post("/", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Authentication required" });

      const { projectId } = req.params;
      const {
        name,
        agentCount = 3,
        agentNames,
        runtimeMode = "full-access",
        initialPrompt,
        provider = "claudeCode",
        model,
      } = req.body;

      if (!name) return res.status(400).json({ error: "name is required" });
      if (agentCount < 1 || agentCount > 6) {
        return res.status(400).json({ error: "agentCount must be 1-6" });
      }

      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return res.status(400).json({ error: "Project not found" });

      // Resolve API key
      let apiKey: string | undefined;
      let githubToken: string | undefined;
      let useSubscription = false;

      if (authProxy) {
        const proxyProvider = provider === "claudeCode" ? "claude" : "codex";
        const proxyToken = await authProxy.getToken(proxyProvider as "claude" | "codex");
        if (proxyToken) apiKey = proxyToken;
      }

      const settings = await prisma.userSettings.findUnique({ where: { userId } });
      if (!apiKey) apiKey = settings?.anthropicApiKey ?? undefined;
      if (provider === "claudeCode" && settings?.claudeSubscription) useSubscription = true;

      const account = await prisma.account.findFirst({
        where: { userId, providerId: "github" },
      });
      githubToken = account?.accessToken ?? undefined;

      // Create team
      const team = await prisma.team.create({
        data: { name, projectId, userId, status: "active" },
      });

      // Generate agent display names
      const names: string[] = agentNames && agentNames.length === agentCount
        ? agentNames
        : Array.from({ length: agentCount }, (_, i) => `agent-${i + 1}`);

      // Create member threads
      const members = [];
      for (let i = 0; i < agentCount; i++) {
        const agentName = names[i];
        const role = i === 0 ? "lead" : "teammate";
        const threadTitle = `[${name}] ${agentName}`;

        // Create worktree for each agent
        const shortId = crypto.randomUUID().slice(0, 8);
        const projectDir = project.workspacePath.substring(0, project.workspacePath.lastIndexOf("/"));
        const worktreeDir = `${projectDir}/worktrees/${shortId}`;
        const worktreeBranch = `team/${team.id.slice(0, 8)}/${agentName}`;

        let resolvedWorktreePath: string | undefined;
        try {
          createWorktree({
            repoDir: project.workspacePath,
            worktreeDir,
            branch: worktreeBranch,
            baseBranch: project.branch,
          });
          resolvedWorktreePath = worktreeDir;
        } catch (err: any) {
          console.warn(`[teams] Worktree creation failed for ${agentName}:`, err.message);
          // Fall back to project workspace (shared)
        }

        const result = await Effect.runPromise(
          providerService.createThread({
            title: threadTitle,
            provider: provider as ProviderKind,
            model,
            runtimeMode,
            workspacePath: resolvedWorktreePath || project.workspacePath,
            useSubscription,
            apiKey,
            githubToken,
            userId,
            projectId,
            worktreePath: resolvedWorktreePath,
            worktreeBranch,
          })
        );

        // Set teamId on the thread
        await prisma.thread.update({
          where: { id: result.thread.id },
          data: { teamId: team.id },
        });

        // Create team member
        const member = await prisma.teamMember.create({
          data: {
            teamId: team.id,
            threadId: result.thread.id,
            role,
            name: agentName,
          },
        });

        members.push({ ...member, thread: result.thread });

        // Send initial prompt if provided
        if (initialPrompt) {
          await Effect.runPromise(
            providerService.sendTurn({
              threadId: ThreadId(result.thread.id),
              text: initialPrompt,
              model,
            })
          );
        }
      }

      res.json({ ...team, members });
    } catch (err: any) {
      console.error("[teams] Create failed:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Stop all team members
  // POST /api/projects/:projectId/teams/:teamId/stop
  router.post("/:teamId/stop", async (req, res) => {
    try {
      const team = await prisma.team.findUnique({
        where: { id: req.params.teamId },
        include: { members: true },
      });
      if (!team) return res.status(404).json({ error: "Team not found" });

      for (const member of team.members) {
        try {
          await Effect.runPromise(
            providerService.stopThread(ThreadId(member.threadId))
          );
        } catch {
          // Ignore — thread may already be stopped
        }
      }

      await prisma.team.update({
        where: { id: team.id },
        data: { status: "idle" },
      });

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Archive team
  // DELETE /api/projects/:projectId/teams/:teamId
  router.delete("/:teamId", async (req, res) => {
    try {
      const team = await prisma.team.findUnique({
        where: { id: req.params.teamId },
        include: { members: true },
      });
      if (!team) return res.status(404).json({ error: "Team not found" });

      // Stop all agents
      for (const member of team.members) {
        try {
          await Effect.runPromise(
            providerService.stopThread(ThreadId(member.threadId))
          );
        } catch { /* ignore */ }
      }

      // Archive all member threads
      await prisma.thread.updateMany({
        where: { teamId: team.id },
        data: { archivedAt: new Date() },
      });

      // Archive team
      await prisma.team.update({
        where: { id: team.id },
        data: { status: "archived" },
      });

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Send inter-agent message
  // POST /api/projects/:projectId/teams/:teamId/messages
  // Body: { fromThreadId, toThreadId?, content }
  router.post("/:teamId/messages", async (req, res) => {
    try {
      const { fromThreadId, toThreadId, content } = req.body;
      if (!fromThreadId || !content) {
        return res.status(400).json({ error: "fromThreadId and content required" });
      }

      const message = await prisma.teamMessage.create({
        data: {
          teamId: req.params.teamId,
          fromThreadId,
          toThreadId: toThreadId || null,
          content,
        },
      });
      res.json(message);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get team messages
  // GET /api/projects/:projectId/teams/:teamId/messages
  router.get("/:teamId/messages", async (req, res) => {
    try {
      const messages = await prisma.teamMessage.findMany({
        where: { teamId: req.params.teamId },
        orderBy: { createdAt: "asc" },
        take: 100,
        include: {
          fromThread: { select: { id: true } },
          toThread: { select: { id: true } },
        },
      });

      // Resolve display names from team members
      const members = await prisma.teamMember.findMany({
        where: { teamId: req.params.teamId },
      });
      const nameMap = new Map(members.map((m) => [m.threadId, m.name]));

      const enriched = messages.map((m) => ({
        ...m,
        fromName: nameMap.get(m.fromThreadId) ?? "unknown",
        toName: m.toThreadId ? nameMap.get(m.toThreadId) ?? "all" : "all",
      }));

      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get aggregated tasks from all team members
  // GET /api/projects/:projectId/teams/:teamId/tasks
  router.get("/:teamId/tasks", async (req, res) => {
    try {
      const members = await prisma.teamMember.findMany({
        where: { teamId: req.params.teamId },
      });
      const threadIds = members.map((m) => m.threadId);
      const nameMap = new Map(members.map((m) => [m.threadId, m.name]));

      // Fetch recent todo events from all member threads
      const events = await prisma.threadEvent.findMany({
        where: {
          threadId: { in: threadIds },
          type: "todo.updated",
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      });

      // Extract latest todo items per thread
      const tasksByThread = new Map<string, any[]>();
      for (const evt of events) {
        if (!tasksByThread.has(evt.threadId)) {
          const payload = evt.payload as any;
          tasksByThread.set(evt.threadId, (payload?.todos ?? []).map((t: any) => ({
            ...t,
            agentName: nameMap.get(evt.threadId) ?? "unknown",
            threadId: evt.threadId,
          })));
        }
      }

      const allTasks = Array.from(tasksByThread.values()).flat();
      res.json(allTasks);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
```

- [ ] **Step 2: Mount the teams router in index.ts**

In `packages/server/src/index.ts`, add import and mount:

After the import for `archiveRouter` (~line 26):
```typescript
import { teamsRouter } from "./api/teams.js";
```

After `app.use("/api/projects", projectsRouter());` (~line 75):
```typescript
app.use("/api/projects/:projectId/teams", teamsRouter(providerService, authProxy));
```

- [ ] **Step 3: Verify server starts without errors**

Run:
```bash
cd packages/server && timeout 5 bun run src/index.ts 2>&1 || true
```

Expected: Server starts, no import or type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/api/teams.ts packages/server/src/index.ts
git commit -m "feat(teams): add teams API router with CRUD, messaging, and task aggregation"
```

---

## Chunk 2: Adapter & Event Integration

### Task 3: Add team event types to provider events

**Files:**
- Modify: `packages/server/src/providers/events.ts:136-155`

- [ ] **Step 1: Add team event payload types**

After the `AskUserPayload` interface (~line 134), add:

```typescript
export interface TeamMessageReceivedPayload {
  teamId: string;
  fromThreadId: string;
  fromName: string;
  content: string;
  toThreadId?: string;
}

export interface TeamTaskUpdatedPayload {
  teamId: string;
  taskId: string;
  status: string;
  ownedBy: string;
  content: string;
}
```

- [ ] **Step 2: Add team events to the ProviderRuntimeEvent union**

In the `ProviderRuntimeEvent` type union (~line 137), add these entries:

```typescript
  | { type: "team.message.received"; payload: TeamMessageReceivedPayload }
  | { type: "team.task.updated"; payload: TeamTaskUpdatedPayload }
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/providers/events.ts
git commit -m "feat(teams): add team.message.received and team.task.updated event types"
```

---

### Task 4: Intercept SendMessage in Claude Code adapter

**Files:**
- Modify: `packages/server/src/providers/claude-code/adapter.ts`

The adapter's message processing loop already detects `TodoWrite` and `AskUserQuestion` tool_use blocks. We add `SendMessage` detection in the same pattern.

- [ ] **Step 1: Find the message processing loop**

Read the adapter to find where `TodoWrite` is detected. It will be in the `runAgentQuery` method, inside the message iteration loop. We need to add a similar block for `SendMessage`.

The pattern will look like:
```typescript
// Inside the message loop where tool_use blocks are processed
if (toolName === "SendMessage") {
  // ... handle inter-agent messaging
}
```

- [ ] **Step 2: Add SendMessage interception**

In the message processing loop (same area as `TodoWrite` detection), add this block:

```typescript
        // --- SendMessage handling (Agent Teams) ---
        // When the agent sends a message to a teammate, route it through
        // the team_messages table and emit a WebSocket event
        if (toolName === "SendMessage") {
          const teamId = state.session.teamId;
          if (teamId) {
            const targetName = (input as any).teammate_name || (input as any).to;
            const msgContent = (input as any).content || (input as any).message || "";

            try {
              // Resolve target thread from team member name
              const { default: teamPrisma } = await import("../../db/prisma.js");
              const targetMember = await teamPrisma.teamMember.findFirst({
                where: { teamId, name: targetName },
              });

              const fromMember = await teamPrisma.teamMember.findFirst({
                where: { teamId, threadId: threadId as string },
              });

              if (targetMember && msgContent) {
                // Write to team_messages
                await teamPrisma.teamMessage.create({
                  data: {
                    teamId,
                    fromThreadId: threadId as string,
                    toThreadId: targetMember.threadId,
                    content: msgContent,
                  },
                });

                // Emit to target thread's WS clients
                await this.enqueue(
                  this.makeEnvelope("team.message.received", ThreadId(targetMember.threadId), {
                    teamId,
                    fromThreadId: threadId as string,
                    fromName: fromMember?.name ?? "unknown",
                    content: msgContent,
                    toThreadId: targetMember.threadId,
                  } as any, turnId)
                );

                // Also emit to sender's WS clients (so the activity bar updates)
                await this.enqueue(
                  this.makeEnvelope("team.message.received", threadId, {
                    teamId,
                    fromThreadId: threadId as string,
                    fromName: fromMember?.name ?? "unknown",
                    content: msgContent,
                    toThreadId: targetMember.threadId,
                  } as any, turnId)
                );
              }
            } catch (err: any) {
              console.warn("[claude-adapter] SendMessage routing failed:", err.message);
            }
          }
        }
```

- [ ] **Step 3: Add teamId to SessionState**

In the `SessionState` interface (around line 39), the session object already has `projectId`. Add `teamId`:

```typescript
    teamId?: string;
```

- [ ] **Step 4: Populate teamId when starting a session**

In `startSession()`, after populating `projectId`, look up the thread's teamId:

```typescript
      // Resolve teamId for agent teams support
      const threadRecord = await prisma.thread.findUnique({
        where: { id: threadId as string },
        select: { teamId: true },
      });
      if (threadRecord?.teamId) {
        state.session.teamId = threadRecord.teamId;
      }
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/providers/claude-code/adapter.ts
git commit -m "feat(teams): intercept SendMessage tool for inter-agent messaging"
```

---

### Task 5: Emit team events via thread WebSocket

**Files:**
- Modify: `packages/server/src/api/thread-ws.ts`

- [ ] **Step 1: Add team event forwarding**

The existing WebSocket fan-out in `thread-ws.ts` already routes all `ProviderEventEnvelope` events to the correct thread's connected clients. Since we emit team events with the correct `threadId` in the envelope (Task 4), they will automatically be routed to the right WebSocket connections.

No changes needed to thread-ws.ts — the existing fan-out handles it.

Verify by reading `thread-ws.ts` and confirming the fan-out logic routes by `envelope.threadId`.

- [ ] **Step 2: Commit** (skip if no changes)

---

## Chunk 3: UI — API Client & Types

### Task 6: Add team types and API methods to the client

**Files:**
- Modify: `packages/ui/src/lib/api.ts`

- [ ] **Step 1: Add team-related types**

After the `ProjectDetail` interface (~line 224), add:

```typescript
export interface TeamItem {
  id: string;
  name: string;
  projectId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  members: TeamMemberItem[];
}

export interface TeamMemberItem {
  id: string;
  teamId: string;
  threadId: string;
  role: string;
  name: string;
  thread: {
    id: string;
    title: string;
    status: string;
    model?: string | null;
    runtimeMode?: string;
  };
}

export interface TeamMessageItem {
  id: string;
  teamId: string;
  fromThreadId: string;
  toThreadId: string | null;
  content: string;
  createdAt: string;
  fromName: string;
  toName: string;
}

export interface CreateTeamRequest {
  name: string;
  agentCount?: number;
  agentNames?: string[];
  runtimeMode?: string;
  initialPrompt?: string;
  provider?: string;
  model?: string;
}
```

- [ ] **Step 2: Add team API methods to PatchworkAPI class**

After the projects section in the `PatchworkAPI` class, add:

```typescript
  // ── Teams API ───────────────────────────────────────────────────
  async listTeams(projectId: string): Promise<TeamItem[]> {
    return request<TeamItem[]>(`/api/projects/${projectId}/teams`);
  }

  async getTeam(projectId: string, teamId: string): Promise<TeamItem> {
    return request<TeamItem>(`/api/projects/${projectId}/teams/${teamId}`);
  }

  async createTeam(projectId: string, input: CreateTeamRequest): Promise<TeamItem> {
    return request<TeamItem>(`/api/projects/${projectId}/teams`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async stopTeam(projectId: string, teamId: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/api/projects/${projectId}/teams/${teamId}/stop`, {
      method: "POST",
    });
  }

  async archiveTeam(projectId: string, teamId: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(`/api/projects/${projectId}/teams/${teamId}`, {
      method: "DELETE",
    });
  }

  async getTeamMessages(projectId: string, teamId: string): Promise<TeamMessageItem[]> {
    return request<TeamMessageItem[]>(`/api/projects/${projectId}/teams/${teamId}/messages`);
  }

  async getTeamTasks(projectId: string, teamId: string): Promise<any[]> {
    return request<any[]>(`/api/projects/${projectId}/teams/${teamId}/tasks`);
  }
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/lib/api.ts
git commit -m "feat(teams): add team types and API client methods"
```

---

## Chunk 4: UI — Team Pane Component

### Task 7: Create the team pane component

**Files:**
- Create: `packages/ui/src/components/team/team-pane.tsx`

This is a slimmed-down version of the thread detail page — just timeline + composer, no diff panel or terminal. Each pane connects its own WebSocket.

- [ ] **Step 1: Create the team-pane component**

Create `packages/ui/src/components/team/team-pane.tsx`:

```tsx
"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import { useThreadSocket, type ThreadEvent } from "@/hooks/use-thread-socket";
import { Timeline, type TimelineItem } from "@/components/thread/timeline";
import { Composer } from "@/components/thread/composer";
import { cn } from "@/lib/utils";

interface TeamPaneProps {
  threadId: string;
  agentName: string;
  role: "lead" | "teammate";
  focused: boolean;
  onFocus: () => void;
  /** Callback when a team message is received (for the activity bar) */
  onTeamMessage?: (msg: { fromName: string; content: string; toThreadId?: string }) => void;
}

export function TeamPane({ threadId, agentName, role, focused, onFocus, onTeamMessage }: TeamPaneProps) {
  const [thread, setThread] = useState<any>(null);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [running, setRunning] = useState(false);
  const assistantTextRef = useRef<string>("");
  const assistantItemIdRef = useRef<string | null>(null);

  // Load thread data
  useEffect(() => {
    api.getThread(threadId).then(setThread).catch(console.error);
  }, [threadId]);

  // Derive running state from thread
  useEffect(() => {
    if (thread) {
      setRunning(["active", "starting"].includes(thread.status));
    }
  }, [thread]);

  const handleEvent = useCallback((event: ThreadEvent) => {
    if (event.type === "thread.event" && event.event) {
      const evt = event.event;
      const payload = evt.payload ?? {};

      switch (evt.type) {
        case "content.delta": {
          if (payload.kind === "text") {
            assistantTextRef.current += payload.delta;
            if (assistantItemIdRef.current) {
              setItems((prev) =>
                prev.map((item) =>
                  item.id === assistantItemIdRef.current
                    ? { ...item, content: assistantTextRef.current, streaming: true }
                    : item
                )
              );
            } else {
              const id = `assistant-${Date.now()}`;
              assistantItemIdRef.current = id;
              setItems((prev) => [
                ...prev,
                { id, kind: "assistant", content: assistantTextRef.current, streaming: true },
              ]);
            }
          }
          break;
        }
        case "turn.started": {
          assistantTextRef.current = "";
          assistantItemIdRef.current = null;
          break;
        }
        case "turn.completed": {
          if (assistantItemIdRef.current) {
            setItems((prev) =>
              prev.map((item) =>
                item.id === assistantItemIdRef.current
                  ? { ...item, streaming: false }
                  : item
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
              id: payload.itemId,
              kind: "work_item",
              toolName: payload.toolName,
              toolCategory: payload.toolCategory,
              input: payload.input,
              status: "running",
            },
          ]);
          break;
        }
        case "item.completed": {
          setItems((prev) =>
            prev.map((item) =>
              item.id === payload.itemId
                ? { ...item, status: "completed", output: payload.output, error: payload.error }
                : item
            )
          );
          break;
        }
        case "request.opened": {
          setItems((prev) => [
            ...prev,
            {
              id: payload.requestId,
              kind: "approval",
              toolName: payload.toolName,
              toolCategory: payload.toolCategory,
              input: payload.input,
              description: payload.description,
              status: "pending",
            },
          ]);
          break;
        }
        case "request.resolved": {
          setItems((prev) =>
            prev.map((item) =>
              item.id === payload.requestId
                ? { ...item, status: payload.decision }
                : item
            )
          );
          break;
        }
        case "team.message.received": {
          onTeamMessage?.({
            fromName: payload.fromName,
            content: payload.content,
            toThreadId: payload.toThreadId,
          });
          break;
        }
      }
    }

    if (event.type === "thread.session.status") {
      setRunning(event.status === "active" || event.status === "starting");
    }

    if (event.type === "thread.error") {
      setItems((prev) => [
        ...prev,
        { id: `error-${Date.now()}`, kind: "error", content: event.error ?? "Unknown error" },
      ]);
      setRunning(false);
    }
  }, [onTeamMessage]);

  const { send, connected } = useThreadSocket({
    threadId,
    onEvent: handleEvent,
    onReconnect: () => {
      api.getThread(threadId).then(setThread).catch(console.error);
    },
  });

  const handleSend = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      // Add user message to timeline
      setItems((prev) => [
        ...prev,
        { id: `user-${Date.now()}`, kind: "user", content: text },
      ]);
      setRunning(true);
      // Send via WebSocket
      send({
        type: "thread.sendTurn",
        text,
      });
    },
    [send]
  );

  const handleInterrupt = useCallback(() => {
    send({ type: "thread.interrupt" });
  }, [send]);

  const handleApproval = useCallback(
    (requestId: string, decision: "allow" | "deny" | "allow_session") => {
      send({
        type: "thread.approval",
        requestId,
        decision,
      });
    },
    [send]
  );

  const statusDot = running
    ? "bg-emerald-400 animate-pulse"
    : connected
      ? "bg-zinc-600"
      : "bg-red-400";

  return (
    <div
      className={cn(
        "flex flex-col h-full border rounded-lg overflow-hidden transition-colors",
        focused
          ? "border-violet-500/60 bg-zinc-950/80"
          : "border-zinc-800/40 bg-zinc-950/50 hover:border-zinc-700/50",
      )}
      onClick={onFocus}
    >
      {/* Pane Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/40 shrink-0">
        <span className={cn("w-2 h-2 rounded-full shrink-0", statusDot)} />
        <span className="text-sm font-medium text-zinc-200 truncate">{agentName}</span>
        {role === "lead" && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-amber-700/30 bg-amber-900/20 text-amber-400">
            lead
          </span>
        )}
        {!connected && (
          <span className="text-[9px] text-red-400 ml-auto">disconnected</span>
        )}
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto">
        <Timeline
          items={items}
          onApproval={handleApproval}
        />
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-zinc-800/40">
        <Composer
          onSend={handleSend}
          onInterrupt={handleInterrupt}
          running={running}
          disabled={!connected}
          placeholder={`Message ${agentName}...`}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/team/team-pane.tsx
git commit -m "feat(teams): add TeamPane component — mini thread view for team grid"
```

---

### Task 8: Create the team activity bar

**Files:**
- Create: `packages/ui/src/components/team/team-activity-bar.tsx`

- [ ] **Step 1: Create the activity bar component**

Create `packages/ui/src/components/team/team-activity-bar.tsx`:

```tsx
"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, MessageSquare, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ActivityItem {
  id: string;
  type: "message" | "task";
  fromName: string;
  toName?: string;
  content: string;
  timestamp: Date;
}

interface TeamActivityBarProps {
  items: ActivityItem[];
}

export function TeamActivityBar({ items }: TeamActivityBarProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (items.length === 0) return null;

  return (
    <div className="border-t border-zinc-800/40 bg-zinc-950/60">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-zinc-800/30 transition-colors"
      >
        {collapsed ? (
          <ChevronUp className="h-3 w-3 text-zinc-500" />
        ) : (
          <ChevronDown className="h-3 w-3 text-zinc-500" />
        )}
        <span className="text-[10px] font-mono uppercase text-zinc-500 tracking-wider">
          Team Activity ({items.length})
        </span>
      </button>

      {!collapsed && (
        <div className="max-h-32 overflow-y-auto px-3 pb-2 space-y-1">
          {items.slice(-20).map((item) => (
            <div key={item.id} className="flex items-start gap-2 text-[11px]">
              {item.type === "message" ? (
                <MessageSquare className="h-3 w-3 text-violet-500/60 mt-0.5 shrink-0" />
              ) : (
                <CheckCircle2 className="h-3 w-3 text-emerald-500/60 mt-0.5 shrink-0" />
              )}
              <span className="text-zinc-400">
                <span className="text-zinc-300 font-medium">{item.fromName}</span>
                {item.toName && item.toName !== "all" && (
                  <>
                    {" → "}
                    <span className="text-zinc-300 font-medium">{item.toName}</span>
                  </>
                )}
                {": "}
                <span className="text-zinc-500">{item.content}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/team/team-activity-bar.tsx
git commit -m "feat(teams): add TeamActivityBar component for inter-agent message feed"
```

---

## Chunk 5: UI — Team Grid View Page

### Task 9: Create the team grid view page

**Files:**
- Create: `packages/ui/src/app/projects/[projectId]/teams/[teamId]/page.tsx`

- [ ] **Step 1: Create the team grid page**

Create `packages/ui/src/app/projects/[projectId]/teams/[teamId]/page.tsx`:

```tsx
"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, type TeamItem } from "@/lib/api";
import { TeamPane } from "@/components/team/team-pane";
import { TeamActivityBar, type ActivityItem } from "@/components/team/team-activity-bar";
import { Square, Archive, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

function gridClass(count: number): string {
  switch (count) {
    case 1: return "grid-cols-1";
    case 2: return "grid-cols-2";
    case 3: return "grid-cols-3";
    case 4: return "grid-cols-2 grid-rows-2";
    case 5: return "grid-cols-3 grid-rows-2";
    case 6: return "grid-cols-3 grid-rows-2";
    default: return "grid-cols-3";
  }
}

export default function TeamViewPage() {
  const { projectId, teamId } = useParams<{ projectId: string; teamId: string }>();
  const router = useRouter();
  const [team, setTeam] = useState<TeamItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [stopping, setStopping] = useState(false);

  // Load team data
  useEffect(() => {
    if (!projectId || !teamId) return;
    api
      .getTeam(projectId, teamId)
      .then((data) => {
        setTeam(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load team:", err);
        setLoading(false);
      });
  }, [projectId, teamId]);

  // Poll for team status updates (3s)
  useEffect(() => {
    if (!projectId || !teamId) return;
    const interval = setInterval(() => {
      api.getTeam(projectId, teamId).then(setTeam).catch(console.error);
    }, 3000);
    return () => clearInterval(interval);
  }, [projectId, teamId]);

  // Handle team messages from panes
  const handleTeamMessage = useCallback((msg: { fromName: string; content: string; toThreadId?: string }) => {
    setActivityItems((prev) => [
      ...prev,
      {
        id: `msg-${Date.now()}-${Math.random()}`,
        type: "message" as const,
        fromName: msg.fromName,
        toName: msg.toThreadId ? undefined : "all",
        content: msg.content.slice(0, 200),
        timestamp: new Date(),
      },
    ]);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const members = team?.members ?? [];
      if (members.length === 0) return;

      // Tab / Shift+Tab to cycle focus
      if (e.key === "Tab" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setFocusedIndex((prev) =>
          e.shiftKey
            ? (prev - 1 + members.length) % members.length
            : (prev + 1) % members.length
        );
        return;
      }

      // Cmd+1-9 to focus pane by number
      if ((e.metaKey || e.ctrlKey) && e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key) - 1;
        if (idx < members.length) {
          e.preventDefault();
          setFocusedIndex(idx);
        }
        return;
      }

      // Cmd+Shift+S to stop all
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "s") {
        e.preventDefault();
        handleStopAll();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [team?.members]);

  async function handleStopAll() {
    if (!projectId || !teamId || stopping) return;
    setStopping(true);
    try {
      await api.stopTeam(projectId, teamId);
      // Refresh team data
      const updated = await api.getTeam(projectId, teamId);
      setTeam(updated);
    } catch (err) {
      console.error("Failed to stop team:", err);
    } finally {
      setStopping(false);
    }
  }

  async function handleArchive() {
    if (!projectId || !teamId) return;
    try {
      await api.archiveTeam(projectId, teamId);
      router.push(`/projects/${projectId}`);
    } catch (err) {
      console.error("Failed to archive team:", err);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (!team) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-zinc-500">
        Team not found
      </div>
    );
  }

  const members = team.members ?? [];
  const anyActive = members.some((m) =>
    ["active", "starting"].includes(m.thread.status)
  );

  return (
    <div className="flex flex-col h-full">
      {/* Team Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/40 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold text-zinc-100">{team.name}</h1>
          <span className="text-[10px] text-zinc-500">
            {members.length} agent{members.length !== 1 ? "s" : ""}
          </span>
          <span
            className={cn(
              "w-2 h-2 rounded-full",
              anyActive ? "bg-emerald-400 animate-pulse" : "bg-zinc-600",
            )}
          />
        </div>

        <div className="flex items-center gap-2">
          {anyActive && (
            <button
              onClick={handleStopAll}
              disabled={stopping}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-900/30 hover:bg-red-900/50 text-red-400 text-xs border border-red-800/30 transition-colors disabled:opacity-50"
            >
              <Square className="h-3 w-3" />
              {stopping ? "Stopping..." : "Stop All"}
            </button>
          )}
          <button
            onClick={handleArchive}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md hover:bg-zinc-800/50 text-zinc-500 text-xs border border-zinc-800/30 transition-colors"
          >
            <Archive className="h-3 w-3" />
            Archive
          </button>
        </div>
      </div>

      {/* Grid of Panes */}
      <div className={cn("grid gap-2 flex-1 p-2 min-h-0", gridClass(members.length))}>
        {members.map((member, idx) => (
          <TeamPane
            key={member.threadId}
            threadId={member.threadId}
            agentName={member.name}
            role={member.role as "lead" | "teammate"}
            focused={focusedIndex === idx}
            onFocus={() => setFocusedIndex(idx)}
            onTeamMessage={handleTeamMessage}
          />
        ))}
      </div>

      {/* Activity Bar */}
      <TeamActivityBar items={activityItems} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/app/projects/[projectId]/teams/[teamId]/page.tsx
git commit -m "feat(teams): add team grid view page with CSS grid split panes"
```

---

## Chunk 6: UI — Sidebar, Dialog & Navigation

### Task 10: Create the new team dialog

**Files:**
- Create: `packages/ui/src/components/team/new-team-dialog.tsx`

- [ ] **Step 1: Create the dialog component**

Create `packages/ui/src/components/team/new-team-dialog.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users, Plus, X } from "lucide-react";

interface NewTeamDialogProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
}

export function NewTeamDialog({ projectId, open, onClose }: NewTeamDialogProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [agentCount, setAgentCount] = useState(3);
  const [agentNames, setAgentNames] = useState<string[]>(["agent-1", "agent-2", "agent-3"]);
  const [runtimeMode, setRuntimeMode] = useState("full-access");
  const [initialPrompt, setInitialPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  function handleCountChange(count: number) {
    const clamped = Math.max(1, Math.min(6, count));
    setAgentCount(clamped);
    setAgentNames((prev) => {
      const updated = [...prev];
      while (updated.length < clamped) updated.push(`agent-${updated.length + 1}`);
      return updated.slice(0, clamped);
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setCreating(true);
    setError("");
    try {
      const team = await api.createTeam(projectId, {
        name: name.trim(),
        agentCount,
        agentNames,
        runtimeMode,
        initialPrompt: initialPrompt.trim() || undefined,
      });
      onClose();
      router.push(`/projects/${projectId}/teams/${team.id}`);
    } catch (err: any) {
      setError(err.message || "Failed to create team");
    } finally {
      setCreating(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl w-full max-w-md p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-zinc-100 flex items-center gap-2">
            <Users className="h-4 w-4 text-violet-400" />
            New Team
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Team name */}
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Team Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Review PR #142"
              className="bg-zinc-800/50 border-zinc-700/40"
              autoFocus
            />
          </div>

          {/* Agent count */}
          <div>
            <label className="text-xs text-zinc-400 block mb-1">
              Number of Agents ({agentCount})
            </label>
            <input
              type="range"
              min={1}
              max={6}
              value={agentCount}
              onChange={(e) => handleCountChange(parseInt(e.target.value))}
              className="w-full accent-violet-500"
            />
          </div>

          {/* Agent names */}
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Agent Names</label>
            <div className="space-y-1.5">
              {agentNames.map((agentName, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-600 w-4">{idx + 1}</span>
                  <Input
                    value={agentName}
                    onChange={(e) => {
                      const updated = [...agentNames];
                      updated[idx] = e.target.value;
                      setAgentNames(updated);
                    }}
                    className="bg-zinc-800/50 border-zinc-700/40 text-sm h-8"
                    placeholder={`agent-${idx + 1}`}
                  />
                  {idx === 0 && (
                    <span className="text-[9px] text-amber-400 shrink-0">lead</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Runtime mode */}
          <div>
            <label className="text-xs text-zinc-400 block mb-1">Runtime Mode</label>
            <div className="flex gap-2">
              {["full-access", "approval-required"].map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setRuntimeMode(mode)}
                  className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${
                    runtimeMode === mode
                      ? "border-violet-500/50 bg-violet-900/20 text-violet-300"
                      : "border-zinc-700/40 bg-zinc-800/30 text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {mode === "full-access" ? "Full Access" : "Approval Required"}
                </button>
              ))}
            </div>
          </div>

          {/* Initial prompt */}
          <div>
            <label className="text-xs text-zinc-400 block mb-1">
              Initial Prompt <span className="text-zinc-600">(optional — sent to all agents)</span>
            </label>
            <textarea
              value={initialPrompt}
              onChange={(e) => setInitialPrompt(e.target.value)}
              placeholder="e.g. Review the codebase for security vulnerabilities..."
              className="w-full bg-zinc-800/50 border border-zinc-700/40 rounded-md px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 resize-none h-20"
            />
          </div>

          {error && (
            <div className="text-xs text-red-400">{error}</div>
          )}

          <Button type="submit" disabled={creating || !name.trim()} className="w-full">
            {creating ? "Creating team..." : "Create Team"}
          </Button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/team/new-team-dialog.tsx
git commit -m "feat(teams): add NewTeamDialog component for creating teams"
```

---

### Task 11: Add TEAMS section to project sidebar

**Files:**
- Modify: `packages/ui/src/components/project-sidebar.tsx`

- [ ] **Step 1: Add team state and imports**

At the top of `project-sidebar.tsx`, add imports:

```typescript
import { Users } from "lucide-react";
import { NewTeamDialog } from "@/components/team/new-team-dialog";
import type { TeamItem } from "@/lib/api";
```

Inside the component, add state:

```typescript
const [teams, setTeams] = useState<TeamItem[]>([]);
const [showNewTeam, setShowNewTeam] = useState(false);
```

- [ ] **Step 2: Fetch teams in the project polling effect**

In the existing `useEffect` that fetches project data (the one with `setInterval(fetchProject, 3000)` at ~line 70-95), also fetch teams:

After `api.getProject(projectId)` resolves, add:

```typescript
api.listTeams(projectId).then((t) => { if (!cancelled) setTeams(t); }).catch(console.error);
```

- [ ] **Step 3: Filter team threads from the THREADS list**

In `sortedThreads`, filter out threads that belong to a team:

```typescript
const teamThreadIds = new Set(teams.flatMap((t) => t.members.map((m) => m.threadId)));

const sortedThreads = project?.threads
  ? [...project.threads]
      .filter((t) => !teamThreadIds.has(t.id))  // Hide team threads
      .sort(/* existing sort logic */)
  : [];
```

- [ ] **Step 4: Add TEAMS section to the sidebar JSX**

After the Threads list section and before the Issues section (~line 316), add:

```tsx
          {/* ── Teams Section ──────────────────────────────────── */}
          {teams.length > 0 && (
            <>
              <div className="px-2 py-1.5 mt-3">
                <span className="text-[10px] font-mono uppercase text-zinc-600 tracking-wider">
                  Teams
                </span>
              </div>
              <div className="space-y-0.5">
                {teams.map((team) => {
                  const isSelected = pathname.includes(`/teams/${team.id}`);
                  const anyActive = team.members.some((m) =>
                    ["active", "starting"].includes(m.thread.status)
                  );
                  return (
                    <Link
                      key={team.id}
                      href={`/projects/${projectId}/teams/${team.id}`}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors min-w-0",
                        isSelected
                          ? "bg-zinc-800/60 text-zinc-100"
                          : "hover:bg-zinc-800/40 text-zinc-400",
                      )}
                    >
                      <Users className="h-3.5 w-3.5 text-violet-500/60 shrink-0" />
                      <span className="text-sm truncate flex-1">{team.name}</span>
                      <span className="text-[10px] text-zinc-600 shrink-0">
                        {team.members.length}
                      </span>
                      <span
                        className={cn(
                          "w-1.5 h-1.5 rounded-full shrink-0",
                          anyActive ? "bg-emerald-400 animate-pulse" : "bg-zinc-600",
                        )}
                      />
                    </Link>
                  );
                })}
              </div>
            </>
          )}
```

- [ ] **Step 5: Add "New Team" button next to "New Thread"**

After the existing "New thread" link (~line 227-237), add:

```tsx
          <button
            onClick={() => setShowNewTeam(true)}
            className="flex items-center justify-between w-full bg-zinc-800/30 hover:bg-zinc-700/40 border border-zinc-700/30 rounded-lg px-3 py-1.5 text-xs text-zinc-400 transition-colors mt-1"
          >
            <span className="flex items-center gap-2">
              <Users className="h-3 w-3" />
              New team
            </span>
          </button>
```

- [ ] **Step 6: Add NewTeamDialog render**

At the end of the component, just before the closing `</div>` tags, add:

```tsx
      <NewTeamDialog
        projectId={projectId}
        open={showNewTeam}
        onClose={() => setShowNewTeam(false)}
      />
```

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/project-sidebar.tsx
git commit -m "feat(teams): add TEAMS section to project sidebar with team listing and creation"
```

---

### Task 12: Add team commands to command palette

**Files:**
- Modify: `packages/ui/src/components/command-palette.tsx`

- [ ] **Step 1: Read command-palette.tsx to find where dynamic commands are registered**

Check the command palette to understand the structure for adding team navigation commands.

- [ ] **Step 2: Add team navigation commands**

In the dynamic commands section where project/thread navigation is registered, add team commands that navigate to team views. Follow the exact same pattern used for thread navigation.

The commands to add:
- "New Team" — navigates to team creation (opens sidebar dialog)
- Team list entries — each team appears as a navigable command

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/command-palette.tsx
git commit -m "feat(teams): add team navigation commands to command palette"
```

---

### Task 13: Add Next.js rewrite for teams API

**Files:**
- Modify: `packages/ui/next.config.ts` (or `next.config.js`)

- [ ] **Step 1: Check existing rewrites configuration**

Read the Next.js config to see how API rewrites are set up (e.g., `/api/*` → server).

- [ ] **Step 2: Verify teams routes are covered**

The teams API is mounted at `/api/projects/:projectId/teams`, which should already be covered by the existing `/api/:path*` rewrite rule. Verify this is the case.

If the rewrite only matches single-level paths, add an explicit rule for teams.

- [ ] **Step 3: Commit** (only if changes needed)

---

### Task 14: Final integration test

- [ ] **Step 1: Start the dev server and verify**

Run:
```bash
cd packages/server && bun run src/index.ts &
cd packages/ui && bun dev &
```

- [ ] **Step 2: Test team creation**

1. Navigate to a project
2. Click "New team" in the sidebar
3. Enter a name, select 3 agents
4. Click "Create Team"
5. Verify redirected to `/projects/[id]/teams/[teamId]`
6. Verify 3 panes appear in CSS grid layout

- [ ] **Step 3: Test pane interaction**

1. Click on a pane to focus it (should get violet border)
2. Type a message and send
3. Verify agent responds in that pane
4. Tab to next pane, verify focus moves
5. Cmd+2 to jump to pane 2

- [ ] **Step 4: Test team controls**

1. Click "Stop All" — all agents should stop
2. Verify sidebar shows team with idle status
3. Archive team — should redirect to project overview

- [ ] **Step 5: Commit final state**

```bash
git add -A
git commit -m "feat(teams): complete agent teams integration with split-pane UI"
```
