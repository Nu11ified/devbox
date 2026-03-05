import { Router, type Router as RouterType } from "express";
import {
  insertIssue,
  findAllIssues,
  findIssueById,
  updateIssue,
  removeIssue,
} from "../db/queries.js";

export const issuesRouter: RouterType = Router();

// POST /api/issues — create a new issue
issuesRouter.post("/", async (req, res) => {
  const { title, repo } = req.body;

  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  if (!repo) {
    res.status(400).json({ error: "repo is required" });
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

// POST /api/issues/:id/dispatch — manually queue an issue for dispatch
issuesRouter.post("/:id/dispatch", async (req, res) => {
  const issue = await findIssueById(req.params.id);
  if (!issue) {
    res.status(404).json({ error: "Issue not found" });
    return;
  }

  if (issue.status !== "open") {
    res.status(400).json({ error: `Cannot dispatch issue with status '${issue.status}', must be 'open'` });
    return;
  }

  const updated = await updateIssue(req.params.id, { status: "queued" });
  res.json(updated);
});
