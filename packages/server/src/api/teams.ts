import { Router } from "express";
import { Effect } from "effect";
import prisma from "../db/prisma.js";
import type { ProviderService } from "../providers/service.js";
import { ThreadId } from "../providers/types.js";
import type { ProviderKind } from "../providers/types.js";
import type { AuthProxy } from "../auth/proxy.js";
import { createWorktree } from "../git/worktree.js";

const PROJECTS_DIR = process.env.PROJECTS_DIR || "/data/patchwork/projects";

export function teamsRouter(providerService: ProviderService, authProxy?: AuthProxy): Router {
  const router = Router({ mergeParams: true });

  // GET / — List teams for a project. Include members with thread status.
  router.get("/", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { projectId } = req.params as any;

      const teams = await prisma.team.findMany({
        where: { projectId, userId },
        orderBy: { createdAt: "desc" },
        include: {
          members: {
            include: {
              thread: {
                select: {
                  id: true,
                  title: true,
                  status: true,
                  provider: true,
                  model: true,
                  updatedAt: true,
                },
              },
            },
          },
          _count: { select: { messages: true } },
        },
      });

      res.json(teams);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /:teamId — Get single team with members and project info.
  router.get("/:teamId", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { projectId, teamId } = req.params as any;

      const team = await prisma.team.findFirst({
        where: { id: teamId, projectId, userId },
        include: {
          project: {
            select: {
              id: true,
              name: true,
              repo: true,
              branch: true,
              workspacePath: true,
            },
          },
          members: {
            include: {
              thread: {
                select: {
                  id: true,
                  title: true,
                  status: true,
                  provider: true,
                  model: true,
                  worktreeBranch: true,
                  updatedAt: true,
                },
              },
            },
          },
          _count: { select: { messages: true } },
        },
      });

      if (!team) return res.status(404).json({ error: "Team not found" });
      res.json(team);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST / — Create team + spawn N member threads.
  // Body: { name, agentCount, agentNames?, runtimeMode?, initialPrompt?, provider?, model? }
  router.post("/", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { projectId } = req.params as any;
      const {
        name,
        agentCount,
        agentNames,
        runtimeMode,
        initialPrompt,
        provider = "claudeCode",
        model,
      } = req.body;

      if (!name || !agentCount || agentCount < 1) {
        return res.status(400).json({ error: "name and agentCount (>= 1) are required" });
      }

      // Validate project exists and belongs to user
      const project = await prisma.project.findFirst({
        where: { id: projectId, userId },
      });
      if (!project) return res.status(404).json({ error: "Project not found" });

      // Resolve API key: AuthProxy token → UserSettings DB key → env fallback
      let apiKey: string | undefined;
      let subscription = false;
      if (authProxy) {
        const proxyProvider = provider === "claudeCode" ? "claude" : "codex";
        const proxyToken = await authProxy.getToken(proxyProvider as "claude" | "codex");
        if (proxyToken) apiKey = proxyToken;
      }

      const settings = await prisma.userSettings.findUnique({ where: { userId } });
      if (provider === "claudeCode" && settings?.claudeSubscription) {
        subscription = true;
      }
      if (!apiKey) {
        apiKey = settings?.anthropicApiKey ?? undefined;
      }

      // Resolve GitHub token from account table
      const account = await prisma.account.findFirst({
        where: { userId, providerId: "github" },
      });
      const githubToken = account?.accessToken ?? undefined;

      // Create Team row
      const team = await prisma.team.create({
        data: {
          name,
          projectId,
          userId,
          status: "active",
        },
      });

      // Derive the project directory (parent of workspacePath)
      const projectDir = project.workspacePath.substring(
        0,
        project.workspacePath.lastIndexOf("/")
      );

      const members: any[] = [];

      // Spawn N member threads
      for (let i = 0; i < agentCount; i++) {
        const agentName =
          (agentNames && agentNames[i]) ? agentNames[i] : `Agent ${i + 1}`;
        const worktreeBranch = `team/${team.id.slice(0, 8)}/agent-${i + 1}`;
        const shortId = crypto.randomUUID().slice(0, 8);
        const worktreeDir = `${projectDir}/worktrees/${shortId}`;

        // Create a worktree for this agent
        try {
          createWorktree({
            repoDir: project.workspacePath,
            worktreeDir,
            branch: worktreeBranch,
            baseBranch: project.branch,
          });
        } catch (err: any) {
          // Clean up team and already-created threads on failure
          await prisma.team.delete({ where: { id: team.id } }).catch(() => {});
          return res.status(500).json({
            error: `Failed to create worktree for agent ${i + 1}: ${err.message}`,
          });
        }

        // Create thread via providerService
        let threadResult: any;
        try {
          threadResult = await Effect.runPromise(
            providerService.createThread({
              title: `${name} — ${agentName}`,
              provider: provider as ProviderKind,
              model,
              runtimeMode: runtimeMode ?? "full-access",
              workspacePath: worktreeDir,
              useSubscription: subscription,
              apiKey,
              githubToken,
              userId,
              projectId,
              worktreePath: worktreeDir,
              worktreeBranch,
            })
          );
        } catch (err: any) {
          await prisma.team.delete({ where: { id: team.id } }).catch(() => {});
          return res.status(500).json({
            error: `Failed to create thread for agent ${i + 1}: ${err.message}`,
          });
        }

        const thread = threadResult.thread;

        // Set teamId on the thread
        await prisma.thread.update({
          where: { id: thread.id },
          data: { teamId: team.id },
        });

        // Create TeamMember row
        const member = await prisma.teamMember.create({
          data: {
            teamId: team.id,
            threadId: thread.id,
            role: "teammate",
            name: agentName,
          },
        });

        members.push({ member, thread });
      }

      // If initialPrompt provided, send as first turn to all agents
      if (initialPrompt) {
        for (const { thread } of members) {
          try {
            await Effect.runPromise(
              providerService.sendTurn({
                threadId: ThreadId(thread.id),
                text: initialPrompt,
              })
            );
          } catch {
            // Non-fatal: initial prompt failure shouldn't block team creation
          }
        }
      }

      // Return team with members
      const teamWithMembers = await prisma.team.findUnique({
        where: { id: team.id },
        include: {
          members: {
            include: {
              thread: {
                select: {
                  id: true,
                  title: true,
                  status: true,
                  provider: true,
                  model: true,
                  worktreeBranch: true,
                },
              },
            },
          },
        },
      });

      res.status(201).json(teamWithMembers);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /:teamId/stop — Stop all member sessions. Update team status to "idle".
  router.post("/:teamId/stop", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { projectId, teamId } = req.params as any;

      const team = await prisma.team.findFirst({
        where: { id: teamId, projectId, userId },
        include: {
          members: {
            include: { thread: true },
          },
        },
      });
      if (!team) return res.status(404).json({ error: "Team not found" });

      // Stop all member sessions
      for (const member of team.members) {
        if (member.thread.status === "active" || member.thread.status === "starting") {
          await Effect.runPromise(
            providerService.stopThread(ThreadId(member.thread.id))
          ).catch(() => {});
        }
      }

      // Update team status to idle
      await prisma.team.update({
        where: { id: team.id },
        data: { status: "idle" },
      });

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /:teamId — Archive team: stop all agents, archive all member threads, set team status "archived".
  router.delete("/:teamId", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { projectId, teamId } = req.params as any;

      const team = await prisma.team.findFirst({
        where: { id: teamId, projectId, userId },
        include: {
          members: {
            include: { thread: true },
          },
        },
      });
      if (!team) return res.status(404).json({ error: "Team not found" });

      // Stop all running agents
      for (const member of team.members) {
        if (member.thread.status === "active" || member.thread.status === "starting") {
          await Effect.runPromise(
            providerService.stopThread(ThreadId(member.thread.id))
          ).catch(() => {});
        }
      }

      // Archive all member threads
      const threadIds = team.members.map((m) => m.threadId);
      await prisma.thread.updateMany({
        where: { id: { in: threadIds } },
        data: { archivedAt: new Date() },
      });

      // Set team status to archived
      await prisma.team.update({
        where: { id: team.id },
        data: { status: "archived" },
      });

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /:teamId/messages — Create inter-agent message.
  // Body: { fromThreadId, toThreadId?, content }
  router.post("/:teamId/messages", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { projectId, teamId } = req.params as any;
      const { fromThreadId, toThreadId, content } = req.body;

      if (!fromThreadId || !content) {
        return res.status(400).json({ error: "fromThreadId and content are required" });
      }

      // Verify team belongs to this project/user
      const team = await prisma.team.findFirst({
        where: { id: teamId, projectId, userId },
      });
      if (!team) return res.status(404).json({ error: "Team not found" });

      const message = await prisma.teamMessage.create({
        data: {
          teamId,
          fromThreadId,
          toThreadId: toThreadId ?? null,
          content,
        },
        include: {
          fromThread: {
            select: { id: true, title: true },
          },
          toThread: {
            select: { id: true, title: true },
          },
        },
      });

      res.status(201).json(message);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /:teamId/messages — Get message history with resolved display names.
  router.get("/:teamId/messages", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { projectId, teamId } = req.params as any;

      // Verify team belongs to this project/user
      const team = await prisma.team.findFirst({
        where: { id: teamId, projectId, userId },
        include: {
          members: {
            select: { threadId: true, name: true, role: true },
          },
        },
      });
      if (!team) return res.status(404).json({ error: "Team not found" });

      const messages = await prisma.teamMessage.findMany({
        where: { teamId },
        orderBy: { createdAt: "asc" },
        include: {
          fromThread: {
            select: { id: true, title: true },
          },
          toThread: {
            select: { id: true, title: true },
          },
        },
      });

      // Enrich messages with display names from TeamMember
      const memberNameMap = new Map(
        team.members.map((m) => [m.threadId, m.name])
      );

      const enriched = messages.map((msg) => ({
        ...msg,
        fromDisplayName: memberNameMap.get(msg.fromThreadId) ?? msg.fromThread.title,
        toDisplayName: msg.toThreadId
          ? (memberNameMap.get(msg.toThreadId) ?? msg.toThread?.title ?? null)
          : null,
      }));

      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /:teamId/tasks — Aggregate todo events from all member threads.
  router.get("/:teamId/tasks", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { projectId, teamId } = req.params as any;

      // Verify team belongs to this project/user
      const team = await prisma.team.findFirst({
        where: { id: teamId, projectId, userId },
        include: {
          members: {
            select: { threadId: true, name: true },
          },
        },
      });
      if (!team) return res.status(404).json({ error: "Team not found" });

      const threadIds = team.members.map((m) => m.threadId);
      const memberNameMap = new Map(team.members.map((m) => [m.threadId, m.name]));

      // Fetch todo events from all member threads
      const todoEvents = await prisma.threadEvent.findMany({
        where: {
          threadId: { in: threadIds },
          type: "todo",
        },
        orderBy: { sequence: "asc" },
        select: {
          id: true,
          threadId: true,
          type: true,
          payload: true,
          createdAt: true,
        },
      });

      const tasks = todoEvents.map((evt) => ({
        ...evt,
        agentName: memberNameMap.get(evt.threadId) ?? evt.threadId,
      }));

      res.json(tasks);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
