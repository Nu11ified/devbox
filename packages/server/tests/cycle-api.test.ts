import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import type { Express } from "express";

vi.mock("../src/db/prisma.js", () => ({
  default: {
    cycleRun: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    cycleNodeResult: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

import prisma from "../src/db/prisma.js";
import { cyclesRouter } from "../src/api/cycles.js";

function buildApp(userId?: string): Express {
  const app = express();
  if (userId) {
    app.use((req, _res, next) => {
      (req as any).user = { id: userId };
      next();
    });
  }
  app.use(express.json());
  app.use("/api/threads/:threadId/cycle", cyclesRouter());
  return app;
}

describe("Cycles API", () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp("user-1");
  });

  describe("GET /api/threads/:threadId/cycle", () => {
    it("returns 404 when no active cycle", async () => {
      const res = await request(app).get("/api/threads/thread-1/cycle");
      expect(res.status).toBe(404);
    });

    it("returns active cycle run with node results", async () => {
      vi.mocked(prisma.cycleRun.findFirst).mockResolvedValueOnce({
        id: "run-1",
        blueprintId: "feature-dev",
        currentNodeIndex: 2,
        status: "running",
        startedAt: new Date(),
        nodeResults: [
          { nodeId: "spec", status: "passed" },
          { nodeId: "plan", status: "passed" },
          { nodeId: "write-tests", status: "running" },
        ],
      } as any);

      const res = await request(app).get("/api/threads/thread-1/cycle");
      expect(res.status).toBe(200);
      expect(res.body.blueprintId).toBe("feature-dev");
      expect(res.body.nodeResults).toHaveLength(3);
    });
  });

  describe("GET /api/threads/:threadId/cycle/history", () => {
    it("returns all cycle runs for a thread", async () => {
      vi.mocked(prisma.cycleRun.findMany).mockResolvedValueOnce([
        { id: "run-1", blueprintId: "feature-dev", status: "completed" },
        { id: "run-2", blueprintId: "code-review", status: "completed" },
      ] as any);

      const res = await request(app).get("/api/threads/thread-1/cycle/history");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });
  });
});
