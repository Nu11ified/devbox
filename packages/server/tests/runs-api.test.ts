import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/index.js";
import type { Express } from "express";

// Mock getPool to avoid real database connections
vi.mock("../src/db/queries.js", () => {
  const runs = new Map<string, Record<string, unknown>>();
  const runSteps = new Map<string, Record<string, unknown>[]>();
  const patches = new Map<string, Record<string, unknown>[]>();
  const transcriptEvents = new Map<string, Record<string, unknown>[]>();

  return {
    getPool: vi.fn().mockReturnValue({
      query: vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
        // Route to appropriate mock based on SQL
        if (sql.includes("INSERT INTO runs")) {
          const id = crypto.randomUUID();
          const run = {
            id,
            status: "pending",
            blueprint_id: params?.[0],
            repo: params?.[1],
            branch: params?.[2],
            task_description: params?.[3],
            created_by: params?.[4],
            config: params?.[5] || "{}",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          runs.set(id, run);
          return { rows: [run], rowCount: 1 };
        }

        if (sql.includes("SELECT * FROM runs WHERE id")) {
          const id = params?.[0] as string;
          const run = runs.get(id);
          return { rows: run ? [run] : [], rowCount: run ? 1 : 0 };
        }

        if (sql.includes("SELECT * FROM runs") && sql.includes("ORDER BY")) {
          return { rows: Array.from(runs.values()), rowCount: runs.size };
        }

        if (sql.includes("UPDATE runs SET status")) {
          const status = params?.[0] as string;
          const id = params?.[1] as string;
          const run = runs.get(id);
          if (run) {
            run.status = status;
            return { rows: [run], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("SELECT * FROM run_steps")) {
          const runId = params?.[0] as string;
          return { rows: runSteps.get(runId) || [], rowCount: 0 };
        }

        if (sql.includes("SELECT * FROM patches WHERE run_id")) {
          const runId = params?.[0] as string;
          return { rows: patches.get(runId) || [], rowCount: 0 };
        }

        if (sql.includes("SELECT * FROM transcript_events")) {
          const runId = params?.[0] as string;
          const events = transcriptEvents.get(runId) || [];
          return { rows: events, rowCount: events.length };
        }

        return { rows: [], rowCount: 0 };
      }),
    }),
    closePool: vi.fn(),
    // Re-export template functions to avoid breaking existing routes
    insertTemplate: vi.fn(),
    findAllTemplates: vi.fn().mockResolvedValue([]),
    findTemplateById: vi.fn(),
    updateTemplate: vi.fn(),
    removeTemplate: vi.fn(),
  };
});

describe("Runs API", () => {
  let app: Express;

  beforeEach(() => {
    app = createApp();
  });

  describe("POST /api/runs", () => {
    it("creates a new run and returns runId", async () => {
      const res = await request(app)
        .post("/api/runs")
        .send({
          blueprintId: "simple",
          repo: "test/repo",
          branch: "main",
          taskDescription: "Implement feature X",
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.status).toBe("pending");
    });

    it("returns 400 when required fields are missing", async () => {
      const res = await request(app)
        .post("/api/runs")
        .send({ blueprintId: "simple" });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });
  });

  describe("GET /api/runs", () => {
    it("lists runs", async () => {
      // Create a run first
      await request(app)
        .post("/api/runs")
        .send({
          blueprintId: "simple",
          repo: "test/repo",
          branch: "main",
          taskDescription: "Test task",
        });

      const res = await request(app).get("/api/runs");

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe("GET /api/runs/:id", () => {
    it("returns run detail", async () => {
      const createRes = await request(app)
        .post("/api/runs")
        .send({
          blueprintId: "simple",
          repo: "test/repo",
          branch: "main",
          taskDescription: "Test task",
        });

      const res = await request(app).get(`/api/runs/${createRes.body.id}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(createRes.body.id);
    });

    it("returns 404 for nonexistent run", async () => {
      const res = await request(app).get("/api/runs/00000000-0000-0000-0000-000000000000");

      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/runs/:id/cancel", () => {
    it("cancels a run", async () => {
      const createRes = await request(app)
        .post("/api/runs")
        .send({
          blueprintId: "simple",
          repo: "test/repo",
          branch: "main",
          taskDescription: "Test task",
        });

      const res = await request(app).post(`/api/runs/${createRes.body.id}/cancel`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("cancelled");
    });

    it("returns 404 for nonexistent run", async () => {
      const res = await request(app).post("/api/runs/00000000-0000-0000-0000-000000000000/cancel");

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/runs/:id/patches", () => {
    it("returns patches for a run", async () => {
      const createRes = await request(app)
        .post("/api/runs")
        .send({
          blueprintId: "simple",
          repo: "test/repo",
          branch: "main",
          taskDescription: "Test task",
        });

      const res = await request(app).get(`/api/runs/${createRes.body.id}/patches`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe("GET /api/runs/:id/transcript", () => {
    it("returns transcript events for a run", async () => {
      const createRes = await request(app)
        .post("/api/runs")
        .send({
          blueprintId: "simple",
          repo: "test/repo",
          branch: "main",
          taskDescription: "Test task",
        });

      const res = await request(app).get(`/api/runs/${createRes.body.id}/transcript`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.events)).toBe(true);
    });
  });
});
