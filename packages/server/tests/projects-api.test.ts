import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import type { Express } from "express";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../src/db/prisma.js", () => ({
  default: {
    project: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
    },
    thread: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    issue: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    account: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
}));

vi.mock("../src/git/pr.js", () => ({
  commitAllChanges: vi.fn(),
  pushBranch: vi.fn(),
}));

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    pulls: {
      create: vi.fn().mockResolvedValue({
        data: { html_url: "https://github.com/owner/repo/pull/42", number: 42 },
      }),
    },
  })),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────

import prisma from "../src/db/prisma.js";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { projectsRouter } from "../src/api/projects.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function buildApp(userId?: string): Express {
  const app = express();
  if (userId) {
    app.use((req, _res, next) => {
      (req as any).user = { id: userId };
      next();
    });
  }
  app.use(express.json());
  app.use("/api/projects", projectsRouter());
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("Projects API", () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp("user-1");
  });

  // ── GET /api/projects ─────────────────────────────────────────────

  describe("GET /api/projects", () => {
    it("returns projects for authenticated user", async () => {
      const mockProjects = [
        { id: "p-1", name: "Project 1", repo: "owner/repo1", _count: { threads: 2, issues: 3 } },
        { id: "p-2", name: "Project 2", repo: "owner/repo2", _count: { threads: 0, issues: 1 } },
      ];
      vi.mocked(prisma.project.findMany).mockResolvedValueOnce(mockProjects as any);

      const res = await request(app).get("/api/projects");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(prisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-1" },
        })
      );
    });

    it("returns 401 when not authenticated", async () => {
      const appNoUser = buildApp();
      const res = await request(appNoUser).get("/api/projects");
      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/projects/:id ─────────────────────────────────────────

  describe("GET /api/projects/:id", () => {
    it("returns project with threads and issues", async () => {
      const mockProject = {
        id: "p-1",
        name: "My Project",
        repo: "owner/repo",
        threads: [
          { id: "t-1", title: "Thread 1", status: "active" },
        ],
        issues: [
          { id: "i-1", title: "Issue 1", status: "open" },
        ],
      };
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce(mockProject as any);

      const res = await request(app).get("/api/projects/p-1");

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("My Project");
      expect(res.body.threads).toHaveLength(1);
      expect(res.body.issues).toHaveLength(1);
    });

    it("returns 404 when project not found", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce(null);

      const res = await request(app).get("/api/projects/nonexistent");

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it("returns 401 when not authenticated", async () => {
      const appNoUser = buildApp();
      const res = await request(appNoUser).get("/api/projects/p-1");
      expect(res.status).toBe(401);
    });
  });

  // ── POST /api/projects ────────────────────────────────────────────

  describe("POST /api/projects", () => {
    it("creates project with name and repo", async () => {
      vi.mocked(prisma.project.create).mockResolvedValueOnce({
        id: "p-new",
        name: "New Project",
        repo: "owner/repo",
        branch: "main",
      } as any);

      const res = await request(app)
        .post("/api/projects")
        .send({ name: "New Project", repo: "owner/repo" });

      expect(res.status).toBe(201);
      expect(prisma.project.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "New Project",
            repo: "owner/repo",
            branch: "main",
            userId: "user-1",
          }),
        })
      );
    });

    it("clones repo with specified branch", async () => {
      vi.mocked(prisma.project.create).mockResolvedValueOnce({
        id: "p-new",
        name: "My Project",
        repo: "owner/repo",
        branch: "develop",
      } as any);

      const res = await request(app)
        .post("/api/projects")
        .send({ name: "My Project", repo: "owner/repo", branch: "develop" });

      expect(res.status).toBe(201);
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["clone", "--branch", "develop"]),
        expect.any(Object)
      );
    });

    it("uses GitHub token in clone URL when available", async () => {
      vi.mocked(prisma.account.findFirst).mockResolvedValueOnce({
        accessToken: "ghp_test123",
      } as any);
      vi.mocked(prisma.project.create).mockResolvedValueOnce({
        id: "p-new",
        name: "Tok Project",
        repo: "owner/repo",
        branch: "main",
      } as any);

      const res = await request(app)
        .post("/api/projects")
        .send({ name: "Tok Project", repo: "owner/repo" });

      expect(res.status).toBe(201);
      const cloneArgs = vi.mocked(execFileSync).mock.calls[0][1] as string[];
      const urlArg = cloneArgs.find((a: string) => a.includes("github.com"));
      expect(urlArg).toContain("x-access-token:ghp_test123");
    });

    it("returns 400 when name is missing", async () => {
      const res = await request(app)
        .post("/api/projects")
        .send({ repo: "owner/repo" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/name.*repo/i);
    });

    it("returns 400 when repo is missing", async () => {
      const res = await request(app)
        .post("/api/projects")
        .send({ name: "No Repo" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/name.*repo/i);
    });

    it("returns 401 when not authenticated", async () => {
      const appNoUser = buildApp();
      const res = await request(appNoUser)
        .post("/api/projects")
        .send({ name: "Test", repo: "owner/repo" });
      expect(res.status).toBe(401);
    });

    it("returns 500 and cleans up on git clone failure", async () => {
      vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
        if (args && (args as string[]).includes("clone")) {
          throw Object.assign(new Error("clone failed"), {
            stderr: Buffer.from("fatal: repository not found"),
          });
        }
        return Buffer.from("");
      });

      const res = await request(app)
        .post("/api/projects")
        .send({ name: "Bad Repo", repo: "owner/nonexistent" });

      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/clone failed/i);
      expect(rmSync).toHaveBeenCalled();
    });
  });

  // ── DELETE /api/projects/:id ──────────────────────────────────────

  describe("DELETE /api/projects/:id", () => {
    it("deletes project and cascading data", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce({
        id: "p-1",
        name: "To Delete",
        userId: "user-1",
        workspacePath: "/data/projects/p-1/repo",
      } as any);

      const res = await request(app).delete("/api/projects/p-1");

      expect(res.status).toBe(204);
      expect(prisma.thread.deleteMany).toHaveBeenCalledWith({
        where: { projectId: "p-1" },
      });
      expect(prisma.issue.updateMany).toHaveBeenCalledWith({
        where: { projectId: "p-1" },
        data: { projectId: null },
      });
      expect(prisma.project.delete).toHaveBeenCalledWith({
        where: { id: "p-1" },
      });
    });

    it("cleans up filesystem directory", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce({
        id: "p-1",
        name: "To Delete",
        userId: "user-1",
      } as any);

      await request(app).delete("/api/projects/p-1");

      expect(rmSync).toHaveBeenCalledWith(
        expect.stringContaining("p-1"),
        expect.objectContaining({ recursive: true, force: true })
      );
    });

    it("returns 404 when project not found", async () => {
      vi.mocked(prisma.project.findFirst).mockResolvedValueOnce(null);

      const res = await request(app).delete("/api/projects/nonexistent");

      expect(res.status).toBe(404);
    });

    it("returns 401 when not authenticated", async () => {
      const appNoUser = buildApp();
      const res = await request(appNoUser).delete("/api/projects/p-1");
      expect(res.status).toBe(401);
    });
  });
});
