import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../src/db/prisma.js", () => ({
  default: {
    thread: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    threadSession: {
      create: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import prisma from "../src/db/prisma.js";
import { ProviderService } from "../src/providers/service.js";
import { ProviderAdapterRegistry } from "../src/providers/registry.js";
import type { ProviderAdapterShape } from "../src/providers/adapter.js";
import { ThreadId } from "../src/providers/types.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function createMockAdapter(): ProviderAdapterShape {
  return {
    provider: "claudeCode" as const,
    capabilities: {
      sessionModelSwitch: "restart-session",
      supportsApprovals: true,
      supportsPlanMode: true,
      supportsResume: true,
    },
    startSession: vi.fn().mockReturnValue(
      Effect.succeed({
        threadId: ThreadId("thread-1"),
        provider: "claudeCode" as const,
        sessionId: "sess-abc",
        model: "claude-sonnet-4-20250514",
        runtimeMode: "approval-required" as const,
      })
    ),
    stopSession: vi.fn().mockReturnValue(Effect.succeed(undefined)),
    stopAll: vi.fn().mockReturnValue(Effect.succeed(undefined)),
    sendTurn: vi.fn().mockReturnValue(Effect.succeed({ turnId: "turn-1" })),
    interruptTurn: vi.fn().mockReturnValue(Effect.succeed(undefined)),
    respondToRequest: vi.fn().mockReturnValue(Effect.succeed(undefined)),
    readThread: vi.fn().mockReturnValue(Effect.succeed({ threadId: ThreadId("thread-1"), events: [] })),
    rollbackThread: vi.fn().mockReturnValue(Effect.succeed({ threadId: ThreadId("thread-1"), events: [] })),
    streamEvents: Effect.succeed(undefined) as any,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("ProviderService", () => {
  let service: ProviderService;
  let adapter: ProviderAdapterShape;

  beforeEach(() => {
    vi.clearAllMocks();

    adapter = createMockAdapter();
    const registry = new ProviderAdapterRegistry();
    registry.register(adapter);
    service = new ProviderService(registry);

    // Default prisma mocks
    vi.mocked(prisma.thread.create).mockResolvedValue({
      id: "thread-1",
      title: "Test",
      provider: "claudeCode",
      status: "starting",
    } as any);
    vi.mocked(prisma.threadSession.create).mockResolvedValue({} as any);
    vi.mocked(prisma.thread.update).mockResolvedValue({} as any);
    vi.mocked(prisma.threadSession.updateMany).mockResolvedValue({ count: 1 } as any);
  });

  // ── createThread ─────────────────────────────────────────────────────

  describe("createThread", () => {
    const baseInput = {
      title: "Test Thread",
      provider: "claudeCode" as const,
      runtimeMode: "approval-required" as const,
      workspacePath: "/workspace",
      useSubscription: false,
    };

    it("stores repo/branch/devboxId in prisma.thread.create data", async () => {
      await Effect.runPromise(
        service.createThread({
          ...baseInput,
          repo: "owner/repo",
          branch: "feat",
          devboxId: "ctr-42",
        })
      );

      expect(prisma.thread.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          repo: "owner/repo",
          branch: "feat",
          devboxId: "ctr-42",
        }),
      });
    });

    it("passes repo/branch to adapter.startSession input", async () => {
      await Effect.runPromise(
        service.createThread({
          ...baseInput,
          repo: "owner/repo",
          branch: "feat",
        })
      );

      expect(adapter.startSession).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: "owner/repo",
          branch: "feat",
        })
      );
    });

    it("creates thread without repo/branch/devboxId (existing behavior)", async () => {
      const result = await Effect.runPromise(service.createThread(baseInput));

      expect(result.thread.id).toBe("thread-1");
      expect(prisma.thread.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: "Test Thread",
          provider: "claudeCode",
        }),
      });
      // These should be undefined (not set)
      const createData = vi.mocked(prisma.thread.create).mock.calls[0][0].data;
      expect(createData.repo).toBeUndefined();
      expect(createData.branch).toBeUndefined();
      expect(createData.devboxId).toBeUndefined();
    });

    it("sets thread status to 'starting' then 'active'", async () => {
      await Effect.runPromise(service.createThread(baseInput));

      // First call: create with status "starting"
      expect(prisma.thread.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ status: "starting" }),
      });
      // Last call: update to status "active"
      expect(prisma.thread.update).toHaveBeenCalledWith({
        where: { id: "thread-1" },
        data: { status: "active" },
      });
    });

    it("creates a threadSession record", async () => {
      await Effect.runPromise(service.createThread(baseInput));

      expect(prisma.threadSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          threadId: "thread-1",
          provider: "claudeCode",
          status: "active",
        }),
      });
    });
  });

  // ── stopThread ───────────────────────────────────────────────────────

  describe("stopThread", () => {
    beforeEach(() => {
      vi.mocked(prisma.thread.findUnique).mockResolvedValue({
        id: "thread-1",
        provider: "claudeCode",
        status: "active",
      } as any);
    });

    it("updates thread status to 'idle'", async () => {
      await Effect.runPromise(service.stopThread(ThreadId("thread-1")));

      expect(prisma.thread.update).toHaveBeenCalledWith({
        where: { id: "thread-1" },
        data: { status: "idle" },
      });
    });

    it("closes active sessions", async () => {
      await Effect.runPromise(service.stopThread(ThreadId("thread-1")));

      expect(prisma.threadSession.updateMany).toHaveBeenCalledWith({
        where: { threadId: "thread-1", status: "active" },
        data: expect.objectContaining({ status: "closed" }),
      });
    });

    it("doesn't fail if adapter.stopSession throws", async () => {
      (adapter.stopSession as any).mockReturnValue(
        Effect.fail(new Error("already stopped"))
      );

      // Should not throw — stopThread catches adapter errors via catchAll
      await expect(
        Effect.runPromise(service.stopThread(ThreadId("thread-1")))
      ).resolves.not.toThrow();

      // DB cleanup still runs
      expect(prisma.thread.update).toHaveBeenCalled();
      expect(prisma.threadSession.updateMany).toHaveBeenCalled();
    });
  });
});
