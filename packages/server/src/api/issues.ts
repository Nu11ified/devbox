import { Router, type Router as RouterType } from "express";
import {
  insertIssue,
  findAllIssues,
  findIssueById,
  updateIssue,
  removeIssue,
} from "../db/queries.js";
import prisma from "../db/prisma.js";
import { requireUser, getUserId } from "../auth/require-user.js";

export const issuesRouter: RouterType = Router();

// Require authentication for all issue routes
issuesRouter.use(requireUser());

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

  // Always set createdByUserId from authenticated session
  const userId = getUserId(req);
  req.body.createdByUserId = userId;

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
  const userId = getUserId(req);
  const { status, repo, priority } = req.query;
  const rows = await findAllIssues({
    status: status as string | undefined,
    repo: repo as string | undefined,
    priority: priority !== undefined ? parseInt(String(priority), 10) : undefined,
    createdByUserId: userId,
  });
  res.json(rows);
});

// GET /api/issues/:id — issue detail
issuesRouter.get("/:id", async (req, res) => {
  const userId = getUserId(req);
  const row = await findIssueById(req.params.id);
  if (!row || row.createdByUserId !== userId) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }
  res.json(row);
});

// PUT /api/issues/:id — update issue
issuesRouter.put("/:id", async (req, res) => {
  const userId = getUserId(req);
  const existing = await prisma.issue.findFirst({
    where: { id: req.params.id, createdByUserId: userId },
  });
  if (!existing) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }
  const row = await updateIssue(req.params.id, req.body);
  if (!row) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }
  res.json(row);
});

// DELETE /api/issues/:id — remove issue
issuesRouter.delete("/:id", async (req, res) => {
  const userId = getUserId(req);
  const existing = await prisma.issue.findFirst({
    where: { id: req.params.id, createdByUserId: userId },
  });
  if (!existing) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }
  const deleted = await removeIssue(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }
  res.status(204).send();
});

// PATCH /api/issues/:id/archive - toggle archive
issuesRouter.patch("/:id/archive", async (req, res) => {
  try {
    const userId = getUserId(req);
    const issue = await prisma.issue.findFirst({
      where: { id: req.params.id, createdByUserId: userId },
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

// POST /api/issues/:id/dispatch — queue an issue for the autonomous orchestrator
issuesRouter.post("/:id/dispatch", async (req, res) => {
  const userId = getUserId(req);
  const issue = await findIssueById(req.params.id);
  if (!issue || issue.createdByUserId !== userId) {
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

  // Queue the issue — the orchestrator polls for "queued" issues and runs
  // the full autonomous pipeline: worktree → thread → prompt → wait → PR
  const updated = await updateIssue(req.params.id, {
    status: "queued",
    lastError: null,
  });

  res.json(updated);
});
