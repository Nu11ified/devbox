import { Router, type Router as RouterType } from "express";
import {
  insertIssue,
  findAllIssues,
  findIssueById,
  updateIssue,
  removeIssue,
} from "../db/queries.js";
import prisma from "../db/prisma.js";
import { createWorktree } from "../git/worktree.js";

export const issuesRouter: RouterType = Router();

/**
 * Sanitize a string for use as a git branch name.
 * Replaces spaces and special characters with dashes, collapses consecutive dashes.
 */
function sanitizeBranchName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\-_/]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

// POST /api/issues — create a new issue
issuesRouter.post("/", async (req, res) => {
  const { title, repo, projectId } = req.body;

  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }

  // If projectId is provided, derive repo from the project
  if (projectId) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      res.status(400).json({ error: "Project not found" });
      return;
    }
    // Use project's repo if not explicitly provided
    if (!req.body.repo) {
      req.body.repo = project.repo;
    }
    if (!req.body.branch) {
      req.body.branch = project.branch;
    }
  } else if (!repo) {
    res.status(400).json({ error: "repo or projectId is required" });
    return;
  }

  try {
    const row = await insertIssue(req.body);
    res.status(201).json(row);
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr.code === "23505") {
      res.status(409).json({ error: "Issue with this identifier already exists" });
      return;
    }
    throw err;
  }
});

// GET /api/issues — list with optional filters
issuesRouter.get("/", async (req, res) => {
  const { status, repo, priority } = req.query;
  const rows = await findAllIssues({
    status: status as string | undefined,
    repo: repo as string | undefined,
    priority: priority !== undefined ? parseInt(String(priority), 10) : undefined,
  });
  res.json(rows);
});

// GET /api/issues/:id — issue detail
issuesRouter.get("/:id", async (req, res) => {
  const row = await findIssueById(req.params.id);
  if (!row) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }
  res.json(row);
});

// PUT /api/issues/:id — update issue
issuesRouter.put("/:id", async (req, res) => {
  const row = await updateIssue(req.params.id, req.body);
  if (!row) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }
  res.json(row);
});

// DELETE /api/issues/:id — remove issue
issuesRouter.delete("/:id", async (req, res) => {
  const deleted = await removeIssue(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }
  res.status(204).send();
});

// POST /api/issues/:id/dispatch — dispatch an issue: create worktree + thread
issuesRouter.post("/:id/dispatch", async (req, res) => {
  const issue = await findIssueById(req.params.id);
  if (!issue) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }

  if (issue.status !== "open" && issue.status !== "queued") {
    res.status(400).json({
      error: `Cannot dispatch issue with status '${issue.status}', must be 'open' or 'queued'`,
    });
    return;
  }

  if (!issue.projectId) {
    res.status(400).json({
      error: "Issue must be assigned to a project before dispatching",
    });
    return;
  }

  const project = await prisma.project.findUnique({
    where: { id: issue.projectId },
  });
  if (!project) {
    res.status(400).json({ error: "Associated project not found" });
    return;
  }

  // Create worktree branch name from issue identifier
  const branchName = `thread/issue-${sanitizeBranchName(issue.identifier)}`;
  const worktreeDir = `${project.workspacePath}/../worktrees/${issue.id.slice(0, 8)}`;

  // Attempt to create the git worktree
  try {
    createWorktree({
      repoDir: project.workspacePath,
      worktreeDir,
      branch: branchName,
      baseBranch: project.branch,
    });
  } catch (err: unknown) {
    console.error("Failed to create worktree:", err);
    // Non-fatal: the thread can still be created without a working worktree
    // (e.g. repo may not exist yet on this machine)
  }

  // Create a thread linked to this issue and project
  const thread = await prisma.thread.create({
    data: {
      title: issue.title,
      provider: "claudeCode",
      runtimeMode: "approval-required",
      status: "idle",
      projectId: issue.projectId,
      worktreePath: worktreeDir,
      worktreeBranch: branchName,
      issueId: issue.id,
      userId: issue.createdByUserId,
    },
  });

  // Update the issue status to in_progress
  const updated = await updateIssue(req.params.id, { status: "in_progress" });

  res.json({
    ...updated,
    thread: {
      id: thread.id,
      status: thread.status,
      worktreeBranch: thread.worktreeBranch,
    },
  });
});
