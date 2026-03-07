import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";

// ── Hoisted mock functions (accessible inside vi.mock factories) ───────────

const { mockQuery, mockUpdateIssue, mockFindTemplateById, mockDevboxInstance, mockEngineInstance } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockUpdateIssue: vi.fn(),
  mockFindTemplateById: vi.fn(),
  mockDevboxInstance: {
    create: vi.fn().mockResolvedValue({ containerId: "ctr-d1", host: "127.0.0.1", status: "running" }),
    destroy: vi.fn().mockResolvedValue(undefined),
  },
  mockEngineInstance: {
    execute: vi.fn().mockResolvedValue({ status: "completed" }),
  },
}));

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../src/db/queries.js", () => ({
  getPool: vi.fn().mockReturnValue({ query: (...args: any[]) => mockQuery(...args) }),
  findTemplateById: (...args: any[]) => mockFindTemplateById(...args),
  updateIssue: (...args: any[]) => mockUpdateIssue(...args),
  closePool: vi.fn(),
  insertTemplate: vi.fn(),
  findAllTemplates: vi.fn().mockResolvedValue([]),
  updateTemplate: vi.fn(),
  removeTemplate: vi.fn(),
}));

vi.mock("../src/db/prisma.js", () => ({
  default: {
    userSettings: { findUnique: vi.fn().mockResolvedValue(null) },
    account: { findFirst: vi.fn().mockResolvedValue(null) },
    devboxTemplate: { findFirst: vi.fn().mockResolvedValue(null) },
    session: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

vi.mock("../src/blueprints/definitions.js", () => ({
  BUILTIN_BLUEPRINTS: new Map(),
}));

vi.mock("../src/devbox/manager.js", () => ({
  DevboxManager: vi.fn().mockImplementation(() => mockDevboxInstance),
}));

vi.mock("../src/agents/sidecar-client.js", () => ({
  SidecarHttpClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../src/agents/router.js", () => ({
  AgentRouter: vi.fn().mockImplementation(() => ({
    selectBackend: vi.fn().mockReturnValue({}),
  })),
}));

vi.mock("../src/blueprints/engine.js", () => ({
  BlueprintEngine: vi.fn().mockImplementation(() => mockEngineInstance),
}));

vi.mock("../src/blueprints/persistent-runner.js", () => ({
  PersistentBlueprintRunner: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("../src/patchwork/store.js", () => ({
  PatchStore: vi.fn().mockImplementation(() => ({})),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { dispatchIssue } from "../src/orchestrator/dispatcher.js";
import { BUILTIN_BLUEPRINTS } from "../src/blueprints/definitions.js";
import prisma from "../src/db/prisma.js";
import type { ProviderService } from "../src/providers/service.js";
import { ThreadId } from "../src/providers/types.js";

// ── Helpers ────────────────────────────────────────────────────────────────

const baseIssue = {
  id: "issue-1",
  identifier: "PATCH-1",
  blueprintId: "simple",
  templateId: null,
  repo: "owner/repo",
  branch: "main",
  title: "Fix bug",
  body: "Description of the bug",
  createdByUserId: "user-1",
};

function createMockProviderService(): ProviderService {
  return {
    createThread: vi.fn().mockReturnValue(
      Effect.succeed({
        thread: { id: "thread-ps-1" },
        session: { sessionId: "sess-1" },
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

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (BUILTIN_BLUEPRINTS as Map<string, any>).clear();
    mockUpdateIssue.mockResolvedValue(undefined);
    // Reset engine/devbox defaults
    mockEngineInstance.execute.mockResolvedValue({ status: "completed" });
    mockDevboxInstance.create.mockResolvedValue({ containerId: "ctr-d1", host: "127.0.0.1", status: "running" });
    mockDevboxInstance.destroy.mockResolvedValue(undefined);
  });

  // ── With providerService ─────────────────────────────────────────────

  describe("with providerService", () => {
    it("calls providerService.createThread with correct repo/branch/title", async () => {
      const ps = createMockProviderService();

      // No blueprint → will fail early, but providerService.createThread runs first
      await dispatchIssue(baseIssue, ps);

      expect(ps.createThread).toHaveBeenCalledTimes(1);
      const callArg = (ps.createThread as any).mock.calls[0][0];
      expect(callArg.title).toBe("Fix bug");
      expect(callArg.repo).toBe("owner/repo");
      expect(callArg.branch).toBe("main");
      expect(callArg.provider).toBe("claudeCode");
      expect(callArg.runtimeMode).toBe("full-access");
    });

    it("sends issue body as first turn via providerService.sendTurn", async () => {
      const ps = createMockProviderService();

      await dispatchIssue(baseIssue, ps);

      expect(ps.sendTurn).toHaveBeenCalledTimes(1);
      const sendArg = (ps.sendTurn as any).mock.calls[0][0];
      expect(sendArg.threadId).toBe(ThreadId("thread-ps-1"));
      expect(sendArg.text).toContain("Fix bug");
      expect(sendArg.text).toContain("Description of the bug");
    });

    it("continues execution even if createThread fails", async () => {
      const ps = createMockProviderService();
      (ps.createThread as any).mockReturnValue(
        Effect.fail(new Error("adapter down"))
      );

      // Should not throw — the try/catch around createThread catches errors
      await expect(dispatchIssue(baseIssue, ps)).resolves.not.toThrow();

      // Should still try to validate blueprint (and fail with "Unknown blueprint")
      expect(mockUpdateIssue).toHaveBeenCalledWith(
        "issue-1",
        expect.objectContaining({ lastError: expect.stringContaining("Unknown blueprint") })
      );
    });
  });

  // ── Without providerService ──────────────────────────────────────────

  describe("without providerService", () => {
    it("skips thread creation when providerService is undefined", async () => {
      await dispatchIssue(baseIssue, undefined);

      // Should just proceed to blueprint validation (which fails since no blueprint registered)
      expect(mockUpdateIssue).toHaveBeenCalledWith(
        "issue-1",
        expect.objectContaining({ lastError: expect.stringContaining("Unknown blueprint") })
      );
    });
  });

  // ── Error handling ───────────────────────────────────────────────────

  describe("error handling", () => {
    it("sets issue to 'open' with error when blueprint not found", async () => {
      await dispatchIssue(baseIssue);

      expect(mockUpdateIssue).toHaveBeenCalledWith("issue-1", {
        status: "open",
        lastError: "Unknown blueprint: simple",
      });
    });

    it("sets issue to 'open' with error when no template available", async () => {
      (BUILTIN_BLUEPRINTS as Map<string, any>).set("simple", { id: "simple", name: "Simple" });
      mockFindTemplateById.mockResolvedValue(null);
      vi.mocked(prisma.devboxTemplate.findFirst).mockResolvedValueOnce(null);

      await dispatchIssue(baseIssue);

      expect(mockUpdateIssue).toHaveBeenCalledWith("issue-1", {
        status: "open",
        lastError: "No devbox template available",
      });
    });

    it("updates run to 'failed' on execution error", async () => {
      (BUILTIN_BLUEPRINTS as Map<string, any>).set("simple", { id: "simple", name: "Simple" });
      mockFindTemplateById.mockResolvedValue(null);
      vi.mocked(prisma.devboxTemplate.findFirst).mockResolvedValueOnce({
        id: "tmpl-1",
        baseImage: "node:20",
        resourceLimits: {},
        envVars: {},
        networkPolicy: "egress-allowed",
      } as any);

      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: "run-1" }] }) // INSERT INTO runs
        .mockResolvedValueOnce({ rows: [] }) // UPDATE runs SET status = 'provisioning'
        .mockResolvedValueOnce({ rows: [{ id: "devbox-db-1" }] }) // INSERT INTO devboxes
        .mockResolvedValueOnce({ rows: [{ id: "devbox-db-1" }] }) // SELECT id FROM devboxes
        .mockResolvedValueOnce({ rows: [] }) // UPDATE runs SET devbox_id
        .mockResolvedValue({ rows: [] }); // remaining queries

      mockEngineInstance.execute.mockRejectedValueOnce(new Error("execution failed"));

      await dispatchIssue(baseIssue);

      // Should update run to failed
      const failedCalls = mockQuery.mock.calls.filter(
        (c: any[]) => typeof c[0] === "string" && c[0].includes("status = 'failed'")
      );
      expect(failedCalls.length).toBeGreaterThanOrEqual(1);
    });

    it("cleans up devbox in finally block", async () => {
      (BUILTIN_BLUEPRINTS as Map<string, any>).set("simple", { id: "simple", name: "Simple" });
      mockFindTemplateById.mockResolvedValue(null);
      vi.mocked(prisma.devboxTemplate.findFirst).mockResolvedValueOnce({
        id: "tmpl-1",
        baseImage: "node:20",
        resourceLimits: {},
        envVars: {},
        networkPolicy: "egress-allowed",
      } as any);

      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: "run-1" }] }) // INSERT INTO runs
        .mockResolvedValueOnce({ rows: [] }) // UPDATE runs SET status = 'provisioning'
        .mockResolvedValueOnce({ rows: [] }) // INSERT INTO devboxes
        .mockResolvedValueOnce({ rows: [{ id: "devbox-db-1" }] }) // SELECT id FROM devboxes
        .mockResolvedValueOnce({ rows: [] }) // UPDATE runs SET devbox_id
        .mockResolvedValue({ rows: [] }); // remaining queries

      mockEngineInstance.execute.mockRejectedValueOnce(new Error("boom"));

      await dispatchIssue(baseIssue);

      expect(mockDevboxInstance.destroy).toHaveBeenCalledWith("ctr-d1");
    });
  });
});
