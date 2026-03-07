import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import { Effect } from "effect";
import type { Express } from "express";

// ── Hoisted mock instances (survive vi.clearAllMocks) ──────────────────────

const mockDevboxInstance = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue({ containerId: "ctr-123", host: "127.0.0.1", status: "running" }),
  destroy: vi.fn().mockResolvedValue(undefined),
  runInContainer: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../src/db/prisma.js", () => ({
  default: {
    thread: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn().mockResolvedValue({}),
    },
    userSettings: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    account: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    threadSession: {
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    session: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock("../src/devbox/manager.js", () => ({
  DevboxManager: vi.fn().mockImplementation(() => mockDevboxInstance),
}));

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
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

// ── Imports (after mocks) ──────────────────────────────────────────────────

import prisma from "../src/db/prisma.js";
import { DevboxManager } from "../src/devbox/manager.js";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { threadsRouter } from "../src/api/threads.js";
import type { ProviderService } from "../src/providers/service.js";
import { ThreadId } from "../src/providers/types.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function createMockProviderService(): ProviderService {
  return {
    createThread: vi.fn().mockReturnValue(
      Effect.succeed({
        thread: {
          id: "thread-1",
          title: "Test Thread",
          provider: "claudeCode",
          status: "active",
        },
        session: {
          threadId: ThreadId("thread-1"),
          provider: "claudeCode" as const,
          sessionId: "sess-1",
          model: "claude-sonnet-4-20250514",
          runtimeMode: "approval-required" as const,
        },
      })
    ),
    sendTurn: vi.fn().mockReturnValue(Effect.succeed({ turnId: "turn-1" })),
    stopThread: vi.fn().mockReturnValue(Effect.succeed(undefined)),
    interruptTurn: vi.fn().mockReturnValue(Effect.succeed(undefined)),
    respondToRequest: vi.fn().mockReturnValue(Effect.succeed(undefined)),
    persistEvent: vi.fn().mockReturnValue(Effect.succeed(undefined)),
    mergedEventStream: vi.fn(),
  } as unknown as ProviderService;
}

function buildApp(providerService: ProviderService, userId?: string): Express {
  const app = express();
  // Inject test user before routes
  if (userId) {
    app.use((req, _res, next) => {
      (req as any).user = { id: userId };
      next();
    });
  }
  app.use(express.json());
  app.use("/api/threads", threadsRouter(providerService));
  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Threads API", () => {
  let mockPS: ProviderService;
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPS = createMockProviderService();
    app = buildApp(mockPS, "user-1");
  });

  // ── POST /api/threads ────────────────────────────────────────────────

  describe("POST /api/threads", () => {
    it("creates thread with title+provider (no repo)", async () => {
      const res = await request(app)
        .post("/api/threads")
        .send({ title: "My Thread", provider: "claudeCode" });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe("thread-1");
      expect(mockPS.createThread).toHaveBeenCalledTimes(1);

      const callArg = (mockPS.createThread as any).mock.calls[0][0];
      expect(callArg.title).toBe("My Thread");
      expect(callArg.provider).toBe("claudeCode");
      expect(callArg.repo).toBeUndefined();
      expect(callArg.devboxId).toBeUndefined();
      // Should not call git clone
      expect(execFileSync).not.toHaveBeenCalled();
    });

    it("creates thread with repo+branch — clones and creates devbox", async () => {
      const res = await request(app)
        .post("/api/threads")
        .send({ title: "Repo Thread", provider: "claudeCode", repo: "owner/repo", branch: "dev" });

      expect(res.status).toBe(201);
      expect(execFileSync).toHaveBeenCalledTimes(1);
      const cloneArgs = (execFileSync as any).mock.calls[0];
      expect(cloneArgs[0]).toBe("git");
      expect(cloneArgs[1]).toContain("clone");
      expect(cloneArgs[1]).toContain("dev");

      // DevboxManager.create should be called
      const dmInstance = mockDevboxInstance;
      expect(dmInstance.create).toHaveBeenCalledTimes(1);

      // providerService.createThread should receive devboxId
      const callArg = (mockPS.createThread as any).mock.calls[0][0];
      expect(callArg.devboxId).toBe("ctr-123");
      expect(callArg.repo).toBe("owner/repo");
      expect(callArg.branch).toBe("dev");
    });

    it("returns 400 when title missing", async () => {
      const res = await request(app)
        .post("/api/threads")
        .send({ provider: "claudeCode" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/title/i);
    });

    it("returns 400 when provider missing", async () => {
      const res = await request(app)
        .post("/api/threads")
        .send({ title: "No Provider" });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/provider/i);
    });

    it("uses githubToken in clone URL when account has accessToken", async () => {
      vi.mocked(prisma.account.findFirst).mockResolvedValueOnce({
        accessToken: "ghp_tok123",
      } as any);

      await request(app)
        .post("/api/threads")
        .send({ title: "Token Clone", provider: "claudeCode", repo: "owner/repo" });

      const cloneArgs = (execFileSync as any).mock.calls[0][1] as string[];
      const cloneUrl = cloneArgs[cloneArgs.length - 1]; // last arg is the dir, second to last is url
      // The URL is in position after "--single-branch"
      const urlArg = cloneArgs.find((a: string) => a.includes("github.com"));
      expect(urlArg).toContain("x-access-token:ghp_tok123");
    });
  });

  // ── POST /api/threads/:id/pr ─────────────────────────────────────────

  describe("POST /api/threads/:id/pr", () => {
    it("returns 404 when thread doesn't exist", async () => {
      vi.mocked(prisma.thread.findUnique).mockResolvedValueOnce(null);

      const res = await request(app).post("/api/threads/nonexistent/pr");
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it("returns 400 when thread has no repo", async () => {
      vi.mocked(prisma.thread.findUnique).mockResolvedValueOnce({
        id: "thread-1",
        title: "No Repo",
        repo: null,
      } as any);

      const res = await request(app).post("/api/threads/thread-1/pr");
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/repo/i);
    });

    it("returns 400 when no GitHub token available", async () => {
      vi.mocked(prisma.thread.findUnique).mockResolvedValueOnce({
        id: "thread-1",
        title: "Has Repo",
        repo: "owner/repo",
      } as any);
      vi.mocked(prisma.account.findFirst).mockResolvedValueOnce(null);

      const res = await request(app).post("/api/threads/thread-1/pr");
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/token/i);
    });

    it("success path with devboxId — runs git in container and creates PR", async () => {
      vi.mocked(prisma.thread.findUnique).mockResolvedValueOnce({
        id: "thread-1",
        title: "PR Thread",
        repo: "owner/repo",
        branch: "main",
        devboxId: "ctr-dev-1",
        workspacePath: "/workspace",
      } as any);
      vi.mocked(prisma.account.findFirst).mockResolvedValueOnce({
        accessToken: "ghp_test",
      } as any);
      vi.mocked(prisma.thread.update).mockResolvedValueOnce({} as any);

      const res = await request(app).post("/api/threads/thread-1/pr");

      expect(res.status).toBe(200);
      expect(res.body.prUrl).toBe("https://github.com/owner/repo/pull/42");
      expect(res.body.prNumber).toBe(42);

      // Should run 4 git commands via runInContainer (checkout, add, commit, push)
      const dmInstance = mockDevboxInstance;
      expect(dmInstance.runInContainer).toHaveBeenCalledTimes(4);
      // Should NOT call execFileSync for git
      expect(execFileSync).not.toHaveBeenCalled();
    });

    it("success path without devboxId — runs git via execFileSync", async () => {
      vi.mocked(prisma.thread.findUnique).mockResolvedValueOnce({
        id: "thread-1",
        title: "PR Thread Host",
        repo: "owner/repo",
        branch: "main",
        devboxId: null,
        workspacePath: "/workspace",
      } as any);
      vi.mocked(prisma.account.findFirst).mockResolvedValueOnce({
        accessToken: "ghp_test",
      } as any);
      vi.mocked(prisma.thread.update).mockResolvedValueOnce({} as any);

      const res = await request(app).post("/api/threads/thread-1/pr");

      expect(res.status).toBe(200);
      expect(res.body.prUrl).toBe("https://github.com/owner/repo/pull/42");
      // 4 git commands via execFileSync (checkout, add, commit, push)
      expect(execFileSync).toHaveBeenCalledTimes(4);
    });
  });

  // ── DELETE /api/threads/:id ──────────────────────────────────────────

  describe("DELETE /api/threads/:id", () => {
    it("deletes thread and returns ok", async () => {
      vi.mocked(prisma.thread.findUnique).mockResolvedValueOnce({
        id: "thread-1",
        status: "idle",
        devboxId: null,
      } as any);

      const res = await request(app).delete("/api/threads/thread-1");

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(prisma.thread.delete).toHaveBeenCalledTimes(1);
    });

    it("stops active session before deletion", async () => {
      vi.mocked(prisma.thread.findUnique).mockResolvedValueOnce({
        id: "thread-1",
        status: "active",
        devboxId: null,
      } as any);

      await request(app).delete("/api/threads/thread-1");

      expect(mockPS.stopThread).toHaveBeenCalledTimes(1);
    });

    it("destroys devbox container when thread has devboxId", async () => {
      vi.mocked(prisma.thread.findUnique).mockResolvedValueOnce({
        id: "thread-1",
        status: "idle",
        devboxId: "ctr-999",
      } as any);

      await request(app).delete("/api/threads/thread-1");

      const dmInstance = mockDevboxInstance;
      expect(dmInstance.destroy).toHaveBeenCalledWith("ctr-999");
    });

    it("removes workspace directory via rmSync", async () => {
      const { rmSync } = await import("node:fs");
      vi.mocked(prisma.thread.findUnique).mockResolvedValueOnce({
        id: "thread-1",
        status: "idle",
        devboxId: null,
      } as any);

      await request(app).delete("/api/threads/thread-1");

      expect(rmSync).toHaveBeenCalledWith(
        expect.stringContaining("thread-1"),
        expect.objectContaining({ recursive: true, force: true })
      );
    });

    it("succeeds even if cleanup errors occur", async () => {
      const dmInstance = mockDevboxInstance;
      dmInstance.destroy.mockRejectedValueOnce(new Error("container gone"));
      vi.mocked(prisma.thread.findUnique).mockResolvedValueOnce({
        id: "thread-1",
        status: "active",
        devboxId: "ctr-bad",
      } as any);
      (mockPS.stopThread as any).mockReturnValueOnce(
        Effect.fail(new Error("session dead"))
      );

      const res = await request(app).delete("/api/threads/thread-1");

      // Deletion still succeeds — cleanup is best-effort
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  // ── GET /api/threads ─────────────────────────────────────────────────

  describe("GET /api/threads", () => {
    it("returns empty array when no userId", async () => {
      // Build app without user
      const appNoUser = buildApp(mockPS);

      const res = await request(appNoUser).get("/api/threads");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      // Should NOT call prisma — early return
      expect(prisma.thread.findMany).not.toHaveBeenCalled();
    });

    it("returns threads for authenticated user", async () => {
      const mockThreads = [
        { id: "t1", title: "Thread 1", _count: { turns: 3, events: 10 } },
        { id: "t2", title: "Thread 2", _count: { turns: 1, events: 5 } },
      ];
      vi.mocked(prisma.thread.findMany).mockResolvedValueOnce(mockThreads as any);

      const res = await request(app).get("/api/threads");

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(prisma.thread.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-1" },
        })
      );
    });
  });

  // ── GET /api/threads/:id ─────────────────────────────────────────────

  describe("GET /api/threads/:id", () => {
    it("returns thread with turns, events, sessions", async () => {
      const mockThread = {
        id: "thread-1",
        title: "Test Thread",
        turns: [{ turnId: "t1", role: "user" }],
        events: [{ id: "e1", type: "text" }],
        sessions: [{ id: "s1", status: "active" }],
      };
      vi.mocked(prisma.thread.findUnique).mockResolvedValueOnce(mockThread as any);

      const res = await request(app).get("/api/threads/thread-1");

      expect(res.status).toBe(200);
      expect(res.body.id).toBe("thread-1");
      expect(res.body.turns).toHaveLength(1);
      expect(res.body.events).toHaveLength(1);
      expect(res.body.sessions).toHaveLength(1);
    });

    it("returns 404 for nonexistent thread", async () => {
      vi.mocked(prisma.thread.findUnique).mockResolvedValueOnce(null);

      const res = await request(app).get("/api/threads/no-such-id");

      expect(res.status).toBe(404);
    });
  });
});
