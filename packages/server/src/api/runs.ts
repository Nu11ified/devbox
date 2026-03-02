import { Router } from "express";
import { getPool } from "../db/queries.js";

export const runsRouter = Router();

// POST /api/runs — create a new run record
runsRouter.post("/", async (req, res) => {
  const { blueprintId, repo, branch, taskDescription, createdBy, config } = req.body;

  if (!blueprintId) {
    res.status(400).json({ error: "blueprintId is required" });
    return;
  }
  if (!repo) {
    res.status(400).json({ error: "repo is required" });
    return;
  }
  if (!taskDescription) {
    res.status(400).json({ error: "taskDescription is required" });
    return;
  }

  const db = getPool();
  const result = await db.query(
    `INSERT INTO runs (blueprint_id, repo, branch, task_description, created_by, config)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [blueprintId, repo, branch || null, taskDescription, createdBy || null, JSON.stringify(config || {})]
  );

  res.status(201).json(result.rows[0]);
});

// GET /api/runs — list runs with optional filters
runsRouter.get("/", async (req, res) => {
  const { status, repo } = req.query;
  const db = getPool();

  let sql = "SELECT * FROM runs";
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (status) {
    conditions.push(`status = $${idx++}`);
    params.push(status);
  }
  if (repo) {
    conditions.push(`repo = $${idx++}`);
    params.push(repo);
  }

  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  const result = await db.query(sql, params);
  res.json(result.rows);
});

// GET /api/runs/:id — run detail with steps
runsRouter.get("/:id", async (req, res) => {
  const db = getPool();
  const runResult = await db.query("SELECT * FROM runs WHERE id = $1", [req.params.id]);

  if (runResult.rows.length === 0) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  const stepsResult = await db.query(
    "SELECT * FROM run_steps WHERE run_id = $1 ORDER BY created_at ASC",
    [req.params.id]
  );

  const patchesResult = await db.query(
    "SELECT * FROM patches WHERE run_id = $1",
    [req.params.id]
  );

  res.json({
    ...runResult.rows[0],
    steps: stepsResult.rows,
    patchCount: patchesResult.rows.length,
  });
});

// POST /api/runs/:id/cancel — set status to cancelled
runsRouter.post("/:id/cancel", async (req, res) => {
  const db = getPool();
  const result = await db.query(
    "UPDATE runs SET status = $1, updated_at = now() WHERE id = $2 RETURNING *",
    ["cancelled", req.params.id]
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  res.json(result.rows[0]);
});

// GET /api/runs/:id/patches — list patches for a run
runsRouter.get("/:id/patches", async (req, res) => {
  const db = getPool();
  const result = await db.query(
    "SELECT * FROM patches WHERE run_id = $1 ORDER BY created_at ASC",
    [req.params.id]
  );
  res.json(result.rows);
});

// GET /api/runs/:id/diff — combined diff from all patches
runsRouter.get("/:id/diff", async (req, res) => {
  const db = getPool();
  const result = await db.query(
    "SELECT patch_path FROM patches WHERE run_id = $1 ORDER BY created_at ASC",
    [req.params.id]
  );

  // Return patch paths — actual content would be loaded from file store
  res.json({
    runId: req.params.id,
    patches: result.rows.map((r: { patch_path: string }) => r.patch_path),
  });
});

// GET /api/runs/:id/transcript — paginated transcript events
runsRouter.get("/:id/transcript", async (req, res) => {
  const { cursor, limit: limitParam } = req.query;
  const limit = Math.min(parseInt(String(limitParam || "50"), 10), 100);
  const db = getPool();

  let sql = "SELECT * FROM transcript_events WHERE run_id = $1";
  const params: unknown[] = [req.params.id];
  let idx = 2;

  if (cursor) {
    sql += ` AND created_at > (SELECT created_at FROM transcript_events WHERE id = $${idx++})`;
    params.push(cursor);
  }

  sql += ` ORDER BY created_at ASC LIMIT $${idx}`;
  params.push(limit);

  const result = await db.query(sql, params);

  const events = result.rows;
  const nextCursor = events.length === limit ? events[events.length - 1].id : null;

  res.json({ events, nextCursor });
});
