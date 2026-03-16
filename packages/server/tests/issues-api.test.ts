import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import type { Express } from "express";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../src/db/prisma.js", () => ({
  default: {
    issue: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
  },
}));

vi.mock("../src/db/queries.js", () => ({
  insertIssue: vi.fn(),
  findAllIssues: vi.fn().mockResolvedValue([]),
  findIssueById: vi.fn().mockResolvedValue(null),
  updateIssue: vi.fn(),
  removeIssue: vi.fn(),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────

import prisma from "../src/db/prisma.js";
import { issuesRouter } from "../src/api/issues.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/issues", issuesRouter);
  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Issues API", () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  describe("PATCH /api/issues/:id/archive", () => {
    it("archives an issue", async () => {
      vi.mocked(prisma.issue.findFirst).mockResolvedValueOnce({
        id: "issue-1",
        archivedAt: null,
      } as any);
      vi.mocked(prisma.issue.update).mockResolvedValueOnce({} as any);

      const res = await request(app).patch("/api/issues/issue-1/archive");

      expect(res.status).toBe(200);
      expect(res.body.archived).toBe(true);
    });

    it("unarchives a previously archived issue", async () => {
      vi.mocked(prisma.issue.findFirst).mockResolvedValueOnce({
        id: "issue-1",
        archivedAt: new Date(),
      } as any);
      vi.mocked(prisma.issue.update).mockResolvedValueOnce({} as any);

      const res = await request(app).patch("/api/issues/issue-1/archive");

      expect(res.status).toBe(200);
      expect(res.body.archived).toBe(false);
    });

    it("returns 404 for nonexistent issue", async () => {
      vi.mocked(prisma.issue.findFirst).mockResolvedValueOnce(null);

      const res = await request(app).patch("/api/issues/no-such-id/archive");

      expect(res.status).toBe(404);
    });
  });
});
