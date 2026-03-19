import { Router } from "express";
import prisma from "../db/prisma.js";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Octokit } from "@octokit/rest";
import { commitAllChanges, pushBranch } from "../git/pr.js";

const PROJECTS_DIR = process.env.PROJECTS_DIR || "/data/patchwork/projects";

export function projectsRouter(): Router {
  const r = Router();

  // List user's projects
  r.get("/", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const projects = await prisma.project.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        include: {
          _count: { select: { threads: true, issues: true } },
          threads: { select: { status: true } },
        },
      });

      // Derive project status from thread statuses
      const enriched = projects.map(({ threads, ...project }) => {
        const hasActive = threads.some((t) =>
          t.status === "active" || t.status === "starting",
        );
        return { ...project, status: hasActive ? "active" : project.status };
      });

      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get single project with threads and issues
  r.get("/:id", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const project = await prisma.project.findFirst({
        where: { id: req.params.id, userId },
        include: {
          threads: {
            where: { archivedAt: null },
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
            where: { status: { not: "archived" } },
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

      // Derive project status from thread statuses
      const hasActive = project.threads.some((t) =>
        t.status === "active" || t.status === "starting",
      );
      const enriched = { ...project, status: hasActive ? "active" : project.status };

      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create project (clone repo into project workspace)
  r.post("/", async (req, res) => {
    try {
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
        execFileSync(
          "git",
          ["clone", "--branch", branch, "--single-branch", cloneUrl, repoDir],
          { stdio: "pipe", timeout: 120000 }
        );
      } catch (err: any) {
        // Clean up on clone failure
        rmSync(projectDir, { recursive: true, force: true });
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
      } catch {
        // Non-fatal: git config failure shouldn't block project creation
      }

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
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Merge all thread branches into a combined PR
  r.post("/:id/merge-prs", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const project = await prisma.project.findFirst({
        where: { id: req.params.id, userId },
        include: {
          threads: {
            where: { worktreeBranch: { not: null } },
            select: { id: true, title: true, worktreeBranch: true },
          },
        },
      });
      if (!project) return res.status(404).json({ error: "Project not found" });
      if (project.threads.length === 0) {
        return res.status(400).json({ error: "No thread branches to merge" });
      }

      // Get GitHub token
      const account = await prisma.account.findFirst({
        where: { userId, providerId: "github" },
      });
      const githubToken = account?.accessToken;
      if (!githubToken) {
        return res.status(400).json({ error: "No GitHub access token available" });
      }

      // Get user identity
      let authorName = "Patchwork";
      let authorEmail = "patchwork@users.noreply.github.com";
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user?.name) authorName = user.name;
      if (user?.email) authorEmail = user.email;

      const cwd = project.workspacePath;
      const [owner, repoName] = project.repo.split("/");
      const integrationBranch = `patchwork/merge-${project.id.slice(0, 8)}-${Date.now()}`;

      // Fetch latest from remote
      if (githubToken) {
        const remoteUrl = `https://x-access-token:${githubToken}@github.com/${project.repo}.git`;
        execFileSync("git", ["remote", "set-url", "origin", remoteUrl], { cwd, stdio: "pipe" });
      }
      execFileSync("git", ["fetch", "origin"], { cwd, stdio: "pipe", timeout: 60000 });

      // Create integration branch from base
      execFileSync("git", ["checkout", "-b", integrationBranch, `origin/${project.branch}`], {
        cwd,
        stdio: "pipe",
      });

      // Merge each thread branch
      const merged: string[] = [];
      for (const thread of project.threads) {
        try {
          execFileSync("git", ["merge", `origin/${thread.worktreeBranch!}`, "--no-edit"], {
            cwd,
            stdio: "pipe",
            env: {
              ...process.env,
              GIT_AUTHOR_NAME: authorName,
              GIT_AUTHOR_EMAIL: authorEmail,
              GIT_COMMITTER_NAME: authorName,
              GIT_COMMITTER_EMAIL: authorEmail,
            },
          });
          merged.push(thread.title);
        } catch {
          // Abort the failed merge and clean up
          try {
            execFileSync("git", ["merge", "--abort"], { cwd, stdio: "pipe" });
          } catch {
            // merge --abort can fail if there's nothing to abort
          }
          // Switch back to base branch and delete the integration branch
          execFileSync("git", ["checkout", project.branch], { cwd, stdio: "pipe" });
          try {
            execFileSync("git", ["branch", "-D", integrationBranch], { cwd, stdio: "pipe" });
          } catch {
            // Non-fatal
          }
          return res.status(409).json({
            error: `Merge conflict on thread: ${thread.title} (branch: ${thread.worktreeBranch})`,
            conflictingThread: thread.id,
          });
        }
      }

      // Push integration branch
      pushBranch({ cwd, branch: integrationBranch, githubToken, repo: project.repo });

      // Create combined PR
      const threadList = project.threads
        .map((t) => `- ${t.title} (\`${t.worktreeBranch}\`)`)
        .join("\n");

      const octokit = new Octokit({ auth: githubToken });
      const { data: pr } = await octokit.pulls.create({
        owner,
        repo: repoName,
        title: `[Patchwork] Combined changes for ${project.name}`,
        head: integrationBranch,
        base: project.branch,
        body: `Combined PR for project **${project.name}**\n\n### Merged threads\n${threadList}\n\nCreated by Patchwork`,
      });

      // Switch back to base branch
      try {
        execFileSync("git", ["checkout", project.branch], { cwd, stdio: "pipe" });
      } catch {
        // Non-fatal
      }

      res.json({ prUrl: pr.html_url, prNumber: pr.number });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete project
  r.delete("/:id", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const project = await prisma.project.findFirst({
        where: { id: req.params.id, userId },
      });
      if (!project) return res.status(404).json({ error: "Not found" });

      // Delete all threads first (cascading)
      await prisma.thread.deleteMany({ where: { projectId: project.id } });
      // Unlink issues (set projectId to null)
      await prisma.issue.updateMany({
        where: { projectId: project.id },
        data: { projectId: null },
      });
      await prisma.project.delete({ where: { id: project.id } });

      // Clean up filesystem
      const projectDir = `${PROJECTS_DIR}/${project.id}`;
      try {
        rmSync(projectDir, { recursive: true, force: true });
      } catch {
        // Non-fatal: filesystem cleanup failure shouldn't cause error response
      }

      res.status(204).end();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return r;
}
