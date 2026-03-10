import { Router } from "express";
import { Effect } from "effect";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import prisma from "../db/prisma.js";
import type { ProviderService } from "../providers/service.js";
import { ThreadId } from "../providers/types.js";
import type { ProviderKind } from "../providers/types.js";
import { DevboxManager } from "../devbox/manager.js";
import type { AuthProxy } from "../auth/proxy.js";
import { Octokit } from "@octokit/rest";
import { createWorktree, removeWorktree } from "../git/worktree.js";
import { commitAllChanges, pushBranch } from "../git/pr.js";

const THREADS_DIR = process.env.THREADS_DIR || "/data/patchwork/threads";
const devboxManager = new DevboxManager();

export function threadsRouter(providerService: ProviderService, authProxy?: AuthProxy): Router {
  const router = Router();

  // List threads for current user
  router.get("/", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.json([]);
      }
      const threads = await prisma.thread.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        include: {
          _count: { select: { turns: true, events: true } },
        },
        take: 50,
      });
      res.json(threads);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get single thread with turns and recent events
  router.get("/:id", async (req, res) => {
    try {
      const thread = await prisma.thread.findUnique({
        where: { id: req.params.id },
        include: {
          turns: { orderBy: { startedAt: "asc" } },
          events: { orderBy: { sequence: "asc" }, take: 500 },
          sessions: { orderBy: { startedAt: "desc" }, take: 1 },
        },
      });
      if (!thread) return res.status(404).json({ error: "Thread not found" });
      res.json(thread);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create thread and start session
  router.post("/", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      const { title, provider, model, runtimeMode, workspacePath, useSubscription, issueId, repo, branch, projectId, worktreeBranch } = req.body;

      if (!title || !provider) {
        return res.status(400).json({ error: "title and provider are required" });
      }

      let subscription = useSubscription ?? false;
      let apiKey: string | undefined;
      let githubToken: string | undefined;

      // Resolve API key: AuthProxy token → UserSettings DB key → env fallback
      if (authProxy) {
        const proxyProvider = provider === "claudeCode" ? "claude" : "codex";
        const proxyToken = await authProxy.getToken(proxyProvider as "claude" | "codex");
        if (proxyToken) apiKey = proxyToken;
      }

      if (userId) {
        const settings = await prisma.userSettings.findUnique({ where: { userId } });
        if (!useSubscription && provider === "claudeCode" && settings?.claudeSubscription) {
          subscription = true;
        }
        // Only fall back to DB key if AuthProxy didn't have one
        if (!apiKey) {
          apiKey = settings?.anthropicApiKey ?? undefined;
        }

        const account = await prisma.account.findFirst({
          where: { userId, providerId: "github" },
        });
        githubToken = account?.accessToken ?? undefined;
      }

      // If projectId is provided, resolve workspace from the project
      let resolvedProjectId: string | undefined = projectId;
      let resolvedWorktreePath: string | undefined;
      let resolvedWorktreeBranch: string | undefined = worktreeBranch;
      let projectWorkspacePath: string | undefined;

      if (projectId) {
        const project = await prisma.project.findUnique({ where: { id: projectId } });
        if (!project) {
          return res.status(400).json({ error: "Project not found" });
        }
        projectWorkspacePath = project.workspacePath;

        if (worktreeBranch) {
          // Create a worktree under the project for this thread
          const shortId = crypto.randomUUID().slice(0, 8);
          const projectDir = project.workspacePath.substring(
            0,
            project.workspacePath.lastIndexOf("/")
          );
          const worktreeDir = `${projectDir}/worktrees/${shortId}`;
          try {
            createWorktree({
              repoDir: project.workspacePath,
              worktreeDir,
              branch: worktreeBranch,
              baseBranch: project.branch,
            });
            resolvedWorktreePath = worktreeDir;
          } catch (err: any) {
            return res.status(500).json({
              error: `Failed to create worktree: ${err.message}`,
            });
          }
        }
      }

      // Default workspace: worktree path > explicit workspacePath > project workspace > /workspace fallback
      let resolvedWorkspacePath = resolvedWorktreePath || workspacePath || projectWorkspacePath || "/workspace";
      if (!resolvedWorkspacePath || resolvedWorkspacePath === "/workspace") {
        // Ensure the path actually exists / is writable
        try {
          if (!existsSync(resolvedWorkspacePath)) {
            mkdirSync(resolvedWorkspacePath, { recursive: true });
          }
        } catch {
          // /workspace isn't writable (not in Docker) — use a temp dir
          const fallback = `/tmp/patchwork-workspace-${crypto.randomUUID().slice(0, 8)}`;
          mkdirSync(fallback, { recursive: true });
          resolvedWorkspacePath = fallback;
        }
      }
      let devboxId: string | undefined;

      // If repo is provided, clone it into a unique per-thread directory
      if (repo) {
        const threadTempId = crypto.randomUUID();
        const gitBranch = branch || "main";
        const cloneUrl = githubToken
          ? `https://x-access-token:${githubToken}@github.com/${repo}.git`
          : `https://github.com/${repo}.git`;

        // Create a unique workspace directory on the host for this thread
        const threadDir = `${THREADS_DIR}/${threadTempId}`;
        if (!existsSync(THREADS_DIR)) {
          mkdirSync(THREADS_DIR, { recursive: true });
        }
        mkdirSync(threadDir, { recursive: true });

        let clonedViaDevbox = false;

        // Try devbox container first (production path)
        try {
          const devbox = await devboxManager.create({
            image: "patchwork-node:latest",
            name: `patchwork-thread-${threadTempId.slice(0, 8)}`,
            binds: [`${threadDir}:/workspace`],
            env: {
              ...(githubToken ? { GITHUB_TOKEN: githubToken } : {}),
              ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
            },
          });

          const cloneResult = await devboxManager.runInContainer(devbox.containerId, [
            "git", "clone", "--branch", gitBranch, "--single-branch", cloneUrl, "/workspace",
          ]);
          if (cloneResult.exitCode !== 0) {
            await devboxManager.destroy(devbox.containerId).catch(() => {});
            throw new Error(`git clone failed: ${cloneResult.stderr}`);
          }

          devboxId = devbox.containerId;
          clonedViaDevbox = true;
        } catch (devboxErr: any) {
          console.log(`[threads] Devbox unavailable (${devboxErr.message}), cloning on host`);
        }

        // Fallback: clone directly on the host (local dev without Docker)
        if (!clonedViaDevbox) {
          try {
            // threadDir exists but is empty — git clone populates it
            execFileSync("git", [
              "clone", "--branch", gitBranch, "--single-branch",
              cloneUrl, threadDir,
            ], { stdio: "pipe", timeout: 60000 });
            console.log(`[threads] Cloned ${repo}@${gitBranch} into ${threadDir}`);
          } catch (cloneErr: any) {
            // Clean up empty dir on failure
            rmSync(threadDir, { recursive: true, force: true });
            throw new Error(`git clone failed: ${cloneErr.stderr?.toString() || cloneErr.message}`);
          }
        }

        // Always use the host path — Agent SDK and PTY run on the host
        resolvedWorkspacePath = threadDir;
      }

      const result = await Effect.runPromise(
        providerService.createThread({
          title,
          provider: provider as ProviderKind,
          model,
          runtimeMode: runtimeMode ?? "approval-required",
          workspacePath: resolvedWorkspacePath,
          useSubscription: subscription,
          apiKey,
          githubToken,
          userId,
          issueId,
          repo,
          branch,
          devboxId,
          projectId: resolvedProjectId,
          worktreePath: resolvedWorktreePath,
          worktreeBranch: resolvedWorktreeBranch,
        })
      );

      res.status(201).json(result.thread);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Send turn
  router.post("/:id/turns", async (req, res) => {
    try {
      const { text, model, attachments } = req.body;
      if (!text) return res.status(400).json({ error: "text is required" });

      const result = await Effect.runPromise(
        providerService.sendTurn({
          threadId: ThreadId(req.params.id),
          text,
          model,
          attachments,
        })
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Respond to approval request
  router.post("/:id/approve", async (req, res) => {
    try {
      const { requestId, decision } = req.body;
      if (!requestId || !decision) {
        return res.status(400).json({ error: "requestId and decision required" });
      }

      await Effect.runPromise(
        providerService.respondToRequest(
          ThreadId(req.params.id),
          requestId,
          decision
        )
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Interrupt current turn
  router.post("/:id/interrupt", async (req, res) => {
    try {
      await Effect.runPromise(
        providerService.interruptTurn(ThreadId(req.params.id))
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Stop thread session
  router.post("/:id/stop", async (req, res) => {
    try {
      await Effect.runPromise(
        providerService.stopThread(ThreadId(req.params.id))
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create PR from thread changes
  router.post("/:id/pr", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      const thread = await prisma.thread.findUnique({
        where: { id: req.params.id },
        include: { project: true },
      });

      if (!thread) return res.status(404).json({ error: "Thread not found" });

      // Resolve repo from project or thread (backward compat)
      const repo = thread.project?.repo || thread.repo;
      if (!repo) return res.status(400).json({ error: "Thread has no associated repo" });

      // Get GitHub token
      let githubToken: string | undefined;
      if (userId) {
        const account = await prisma.account.findFirst({
          where: { userId, providerId: "github" },
        });
        githubToken = account?.accessToken ?? undefined;
      }
      if (!githubToken) {
        return res.status(400).json({ error: "No GitHub access token available" });
      }

      // Get user identity for commit authorship
      let authorName = "Patchwork";
      let authorEmail = "patchwork@users.noreply.github.com";
      if (userId) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (user?.name) authorName = user.name;
        if (user?.email) authorEmail = user.email;
      }

      const [owner, repoName] = repo.split("/");
      const baseBranch = thread.project?.branch || thread.branch || "main";

      // Determine workspace and branch
      const cwd = thread.worktreePath || thread.workspacePath || thread.project?.workspacePath || "/workspace";
      const branchName = thread.worktreeBranch || `patchwork/thread-${thread.id.slice(0, 8)}`;

      // If thread has no worktreeBranch (legacy thread), create a new branch
      if (!thread.worktreeBranch) {
        try {
          execFileSync("git", ["checkout", "-b", branchName], { cwd, stdio: "pipe" });
        } catch {
          // Branch may already exist — try switching to it
          execFileSync("git", ["checkout", branchName], { cwd, stdio: "pipe" });
        }
      }

      // Commit with user identity
      commitAllChanges({
        cwd,
        message: `Changes from Patchwork thread: ${thread.title}`,
        authorName,
        authorEmail,
      });

      // Push branch
      pushBranch({ cwd, branch: branchName, githubToken, repo });

      // Create PR via GitHub API
      const octokit = new Octokit({ auth: githubToken });
      const { data: pr } = await octokit.pulls.create({
        owner,
        repo: repoName,
        title: thread.title,
        head: branchName,
        base: baseBranch,
        body: `Created by Patchwork from thread: ${thread.title}\n\nThread ID: ${thread.id}`,
      });

      // Touch updatedAt
      await prisma.thread.update({
        where: { id: thread.id },
        data: { updatedAt: new Date() },
      });

      res.json({ prUrl: pr.html_url, prNumber: pr.number, branch: branchName });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete thread
  router.delete("/:id", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      const where: any = { id: req.params.id };
      if (userId) where.userId = userId;

      // Look up thread for cleanup before deletion
      const thread = await prisma.thread.findUnique({ where: { id: req.params.id } });
      if (thread) {
        try {
          // Stop session if still active
          if (thread.status === "active") {
            await Effect.runPromise(
              providerService.stopThread(ThreadId(thread.id))
            ).catch(() => {});
          }
          // Destroy devbox container if present
          if (thread.devboxId) {
            await devboxManager.destroy(thread.devboxId).catch(() => {});
          }
          // Remove git worktree if thread belongs to a project
          if (thread.worktreePath && thread.projectId) {
            const project = await prisma.project.findUnique({ where: { id: thread.projectId } });
            if (project) {
              removeWorktree(project.workspacePath, thread.worktreePath);
            }
          }
          // Remove workspace directory
          const threadDir = `${THREADS_DIR}/${thread.id}`;
          rmSync(threadDir, { recursive: true, force: true });
        } catch {
          // Cleanup errors should not prevent thread deletion
        }
      }

      await prisma.thread.delete({ where });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
