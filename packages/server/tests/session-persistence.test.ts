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
      findFirst: vi.fn(),
    },
    threadTurn: {
      create: vi.fn(),
    },
    threadEvent: {
      create: vi.fn(),
    },
  },
}));

import prisma from "../src/db/prisma.js";
import { ProviderService } from "../src/providers/service.js";
import { ProviderAdapterRegistry } from "../src/providers/registry.js";
import type { ProviderAdapterShape } from "../src/providers/adapter.js";
import { ThreadId } from "../src/providers/types.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function createMockAdapter(overrides?: Partial<ProviderAdapterShape>): ProviderAdapterShape {
  return {
    provider: "claudeCode" as const,
    capabilities: {
      sessionModelSwitch: "restart-session",
      supportsApprovals: true,
      supportsPlanMode: true,
      supportsResume: true,
    },
    hasSession: vi.fn().mockReturnValue(false),
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
    ...overrides,
  } as ProviderAdapterShape;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("Session Persistence", () => {
  let service: ProviderService;
  let adapter: ProviderAdapterShape;

  beforeEach(() => {
    vi.clearAllMocks();

    adapter = createMockAdapter();
    const registry = new ProviderAdapterRegistry();
    registry.register(adapter);
    service = new ProviderService(registry);

    // Default mocks
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

  // ── Session creation stores ThreadSession record ──────────────────

  describe("createThread - session persistence", () => {
    const baseInput = {
      title: "Test Thread",
      provider: "claudeCode" as const,
      runtimeMode: "approval-required" as const,
      workspacePath: "/workspace",
      useSubscription: false,
    };

    it("creates a ThreadSession record with active status", async () => {
      await Effect.runPromise(service.createThread(baseInput));

      expect(prisma.threadSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          threadId: "thread-1",
          provider: "claudeCode",
          model: "claude-sonnet-4-20250514",
          status: "active",
        }),
      });
    });

    it("stores the model from the adapter session response", async () => {
      (adapter.startSession as any).mockReturnValue(
        Effect.succeed({
          threadId: ThreadId("thread-1"),
          provider: "claudeCode" as const,
          sessionId: "sess-new",
          model: "claude-opus-4-6",
          runtimeMode: "full-access" as const,
        })
      );

      await Effect.runPromise(service.createThread(baseInput));

      expect(prisma.threadSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          model: "claude-opus-4-6",
        }),
      });
    });
  });

  // ── ensureSession with resume cursor ──────────────────────────────

  describe("ensureSession - resume cursor retrieval", () => {
    beforeEach(() => {
      vi.mocked(prisma.thread.findUnique).mockResolvedValue({
        id: "thread-1",
        provider: "claudeCode",
        model: "claude-sonnet-4-20250514",
        runtimeMode: "approval-required",
        workspacePath: "/workspace",
        status: "idle",
        repo: null,
        branch: null,
        projectId: null,
      } as any);
    });

    it("queries last session for resume cursor", async () => {
      vi.mocked(prisma.threadSession.findFirst).mockResolvedValueOnce({
        resumeCursor: "cursor-abc-123",
      } as any);

      await Effect.runPromise(service.ensureSession(ThreadId("thread-1")));

      expect(prisma.threadSession.findFirst).toHaveBeenCalledWith({
        where: { threadId: "thread-1" },
        orderBy: { startedAt: "desc" },
        select: { resumeCursor: true },
      });
    });

    it("passes resume cursor to adapter.startSession", async () => {
      vi.mocked(prisma.threadSession.findFirst).mockResolvedValueOnce({
        resumeCursor: "cursor-xyz-789",
      } as any);

      await Effect.runPromise(service.ensureSession(ThreadId("thread-1")));

      expect(adapter.startSession).toHaveBeenCalledWith(
        expect.objectContaining({
          resumeCursor: "cursor-xyz-789",
        })
      );
    });

    it("passes undefined resume cursor when no prior session exists", async () => {
      vi.mocked(prisma.threadSession.findFirst).mockResolvedValueOnce(null);

      await Effect.runPromise(service.ensureSession(ThreadId("thread-1")));

      expect(adapter.startSession).toHaveBeenCalledWith(
        expect.objectContaining({
          resumeCursor: undefined,
        })
      );
    });

    it("skips session restart when adapter already has session", async () => {
      (adapter.hasSession as any).mockReturnValue(true);

      await Effect.runPromise(service.ensureSession(ThreadId("thread-1")));

      expect(adapter.startSession).not.toHaveBeenCalled();
      expect(prisma.threadSession.findFirst).not.toHaveBeenCalled();
    });

    it("updates thread status to active after session restart", async () => {
      vi.mocked(prisma.threadSession.findFirst).mockResolvedValueOnce(null);

      await Effect.runPromise(service.ensureSession(ThreadId("thread-1")));

      expect(prisma.thread.update).toHaveBeenCalledWith({
        where: { id: "thread-1" },
        data: { status: "active" },
      });
    });

    it("creates a new ThreadSession record on restart", async () => {
      vi.mocked(prisma.threadSession.findFirst).mockResolvedValueOnce(null);

      await Effect.runPromise(service.ensureSession(ThreadId("thread-1")));

      expect(prisma.threadSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          threadId: "thread-1",
          provider: "claudeCode",
          status: "active",
        }),
      });
    });

    it("fails with SessionNotFoundError when thread doesn't exist", async () => {
      vi.mocked(prisma.thread.findUnique).mockResolvedValueOnce(null);

      const result = Effect.runPromise(service.ensureSession(ThreadId("nonexistent")));

      await expect(result).rejects.toThrow();
    });
  });

  // ── Session status transitions ────────────────────────────────────

  describe("session status transitions", () => {
    it("stopThread transitions active sessions to closed", async () => {
      vi.mocked(prisma.thread.findUnique).mockResolvedValueOnce({
        id: "thread-1",
        provider: "claudeCode",
        status: "active",
      } as any);

      await Effect.runPromise(service.stopThread(ThreadId("thread-1")));

      expect(prisma.threadSession.updateMany).toHaveBeenCalledWith({
        where: { threadId: "thread-1", status: "active" },
        data: expect.objectContaining({
          status: "closed",
          endedAt: expect.any(Date),
        }),
      });
    });

    it("stopThread updates thread status to idle", async () => {
      vi.mocked(prisma.thread.findUnique).mockResolvedValueOnce({
        id: "thread-1",
        provider: "claudeCode",
        status: "active",
      } as any);

      await Effect.runPromise(service.stopThread(ThreadId("thread-1")));

      expect(prisma.thread.update).toHaveBeenCalledWith({
        where: { id: "thread-1" },
        data: { status: "idle" },
      });
    });
  });
});
