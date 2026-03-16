import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import type { Express } from "express";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../src/db/prisma.js", () => ({
  default: {
    issue: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    thread: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
  },
}));

// Need to mock @prisma/client for Prisma.sql and Prisma.empty
vi.mock("@prisma/client", () => ({
  Prisma: {
    sql: (...args: unknown[]) => args,
    empty: "",
  },
}));

import prisma from "../src/db/prisma.js";
import { archiveRouter } from "../src/api/archive.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/archive", archiveRouter);
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("Archive API", () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp();
  });

  // ── GET /api/archive (no query) ───────────────────────────────────

  describe("GET /api/archive (no search query)", () => {
    it("returns empty results when no archived items exist", async () => {
      vi.mocked(prisma.issue.findMany).mockResolvedValueOnce([]);
      vi.mocked(prisma.thread.findMany).mockResolvedValueOnce([]);
      vi.mocked(prisma.issue.count).mockResolvedValueOnce(0 as any);
      vi.mocked(prisma.thread.count).mockResolvedValueOnce(0 as any);

      const res = await request(app).get("/api/archive");

      expect(res.status).toBe(200);
      expect(res.body.results).toEqual([]);
      expect(res.body.total).toBe(0);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(20);
    });

    it("returns archived issues as 'issue' kind", async () => {
      const now = new Date();
      vi.mocked(prisma.issue.findMany).mockResolvedValueOnce([
        {
          id: "issue-1",
          identifier: "ISS-1",
          title: "Archived Issue",
          body: "body text",
          status: "archived",
          priority: 2,
          repo: "owner/repo",
          archivedAt: now,
          createdAt: now,
          updatedAt: now,
          prUrl: null,
          projectId: "proj-1",
          project: { id: "proj-1", name: "My Project" },
          thread: { id: "thread-1" },
        },
      ] as any);
      vi.mocked(prisma.thread.findMany).mockResolvedValueOnce([]);
      vi.mocked(prisma.issue.count).mockResolvedValueOnce(1 as any);
      vi.mocked(prisma.thread.count).mockResolvedValueOnce(0 as any);

      const res = await request(app).get("/api/archive");

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(1);
      expect(res.body.results[0].kind).toBe("issue");
      expect(res.body.results[0].identifier).toBe("ISS-1");
      expect(res.body.results[0].projectName).toBe("My Project");
      expect(res.body.results[0].threadId).toBe("thread-1");
      expect(res.body.total).toBe(1);
    });

    it("returns archived threads as 'thread' kind", async () => {
      const now = new Date();
      vi.mocked(prisma.issue.findMany).mockResolvedValueOnce([]);
      vi.mocked(prisma.thread.findMany).mockResolvedValueOnce([
        {
          id: "thread-1",
          title: "Archived Thread",
          status: "archived",
          archivedAt: now,
          createdAt: now,
          updatedAt: now,
          projectId: null,
          project: null,
        },
      ] as any);
      vi.mocked(prisma.issue.count).mockResolvedValueOnce(0 as any);
      vi.mocked(prisma.thread.count).mockResolvedValueOnce(1 as any);

      const res = await request(app).get("/api/archive");

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(1);
      expect(res.body.results[0].kind).toBe("thread");
      expect(res.body.results[0].title).toBe("Archived Thread");
      expect(res.body.total).toBe(1);
    });

    it("filters by projectId", async () => {
      vi.mocked(prisma.issue.findMany).mockResolvedValueOnce([]);
      vi.mocked(prisma.thread.findMany).mockResolvedValueOnce([]);
      vi.mocked(prisma.issue.count).mockResolvedValueOnce(0 as any);
      vi.mocked(prisma.thread.count).mockResolvedValueOnce(0 as any);

      const res = await request(app).get("/api/archive?projectId=proj-1");

      expect(res.status).toBe(200);
      expect(prisma.issue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ projectId: "proj-1" }),
        })
      );
      expect(prisma.thread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ projectId: "proj-1" }),
        })
      );
    });

    it("respects pagination parameters", async () => {
      vi.mocked(prisma.issue.findMany).mockResolvedValueOnce([]);
      vi.mocked(prisma.thread.findMany).mockResolvedValueOnce([]);
      vi.mocked(prisma.issue.count).mockResolvedValueOnce(0 as any);
      vi.mocked(prisma.thread.count).mockResolvedValueOnce(0 as any);

      const res = await request(app).get("/api/archive?page=2&limit=10");

      expect(res.status).toBe(200);
      expect(res.body.page).toBe(2);
      expect(res.body.limit).toBe(10);
    });

    it("clamps limit to max 50", async () => {
      vi.mocked(prisma.issue.findMany).mockResolvedValueOnce([]);
      vi.mocked(prisma.thread.findMany).mockResolvedValueOnce([]);
      vi.mocked(prisma.issue.count).mockResolvedValueOnce(0 as any);
      vi.mocked(prisma.thread.count).mockResolvedValueOnce(0 as any);

      const res = await request(app).get("/api/archive?limit=100");

      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(50);
    });
  });

  // ── GET /api/archive?q=search (with query) ────────────────────────

  describe("GET /api/archive?q=search", () => {
    it("searches with text query using $queryRaw", async () => {
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([]) // issue results
        .mockResolvedValueOnce([]); // thread results

      const res = await request(app).get("/api/archive?q=bug+fix");

      expect(res.status).toBe(200);
      expect(res.body.results).toEqual([]);
      // $queryRaw should be called twice: once for issues, once for threads
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it("returns mapped issue results from full-text search", async () => {
      const now = new Date();
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([
          {
            id: "issue-1",
            identifier: "ISS-42",
            title: "Fix the bug",
            body: "There was a bug",
            status: "archived",
            priority: 1,
            repo: "owner/repo",
            archived_at: now,
            created_at: now,
            updated_at: now,
            pr_url: "https://github.com/owner/repo/pull/5",
            project_id: "proj-1",
            project_name: "My Project",
            thread_id: "thread-1",
            snippet: "found the **bug** in the code",
          },
        ])
        .mockResolvedValueOnce([]); // no thread results

      const res = await request(app).get("/api/archive?q=bug");

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(1);
      expect(res.body.results[0].kind).toBe("issue");
      expect(res.body.results[0].snippet).toContain("**bug**");
      expect(res.body.results[0].prUrl).toBe("https://github.com/owner/repo/pull/5");
    });

    it("returns mapped thread results from full-text search", async () => {
      const now = new Date();
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([]) // no issue results
        .mockResolvedValueOnce([
          {
            id: "thread-1",
            title: "Debug session",
            status: "archived",
            archived_at: now,
            created_at: now,
            updated_at: now,
            project_id: null,
            project_name: null,
            snippet: "debugging the **crash**",
          },
        ]);

      const res = await request(app).get("/api/archive?q=crash");

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(1);
      expect(res.body.results[0].kind).toBe("thread");
      expect(res.body.results[0].snippet).toContain("**crash**");
    });

    it("merges and sorts issue and thread results by archivedAt", async () => {
      const older = new Date("2026-01-01");
      const newer = new Date("2026-02-01");
      vi.mocked(prisma.$queryRaw)
        .mockResolvedValueOnce([
          {
            id: "issue-1",
            identifier: "ISS-1",
            title: "Old Issue",
            body: "",
            status: "archived",
            priority: 0,
            repo: "",
            archived_at: older,
            created_at: older,
            updated_at: older,
            pr_url: null,
            project_id: null,
            project_name: null,
            thread_id: null,
            snippet: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: "thread-1",
            title: "Newer Thread",
            status: "archived",
            archived_at: newer,
            created_at: newer,
            updated_at: newer,
            project_id: null,
            project_name: null,
            snippet: null,
          },
        ]);

      const res = await request(app).get("/api/archive?q=test");

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(2);
      // Newer should come first (descending sort)
      expect(res.body.results[0].id).toBe("thread-1");
      expect(res.body.results[1].id).toBe("issue-1");
    });
  });
});
