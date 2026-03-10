import { Router } from "express";
import prisma from "../db/prisma.js";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

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
        },
      });
      res.json(projects);
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
