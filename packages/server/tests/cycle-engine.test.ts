// packages/server/tests/cycle-engine.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/db/prisma.js", () => ({
  default: {
    cycleRun: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
    },
    cycleNodeResult: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock("../src/cycles/gates.js", () => ({
  runGateChecks: vi.fn().mockResolvedValue([]),
}));

import prisma from "../src/db/prisma.js";
import { runGateChecks } from "../src/cycles/gates.js";
import { CycleEngine } from "../src/cycles/engine.js";
import type { Blueprint, SkipContext } from "../src/cycles/types.js";

const simpleBp: Blueprint = {
  id: "test-cycle",
  name: "Test Cycle",
  description: "A test blueprint",
  trigger: { keywords: [] },
  nodes: [
    { id: "implement", name: "Implement", type: "agentic" },
    {
      id: "typecheck",
      name: "Typecheck",
      type: "deterministic",
      gate: { checks: [{ type: "typecheck", language: "typescript" }], onFail: "retry" },
    },
    { id: "fix", name: "Fix", type: "agentic", maxIterations: 2, retryFromNodeId: "typecheck" },
  ],
};

const emitMock = vi.fn();

describe("CycleEngine", () => {
  let engine: CycleEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.cycleRun.create).mockResolvedValue({ id: "run-1" } as any);
    vi.mocked(prisma.cycleRun.update).mockResolvedValue({} as any);
    vi.mocked(prisma.cycleNodeResult.create).mockResolvedValue({} as any);
    vi.mocked(prisma.cycleNodeResult.update).mockResolvedValue({} as any);
    // Default: findMany returns node results with IDs for composite lookup
    vi.mocked(prisma.cycleNodeResult.findMany).mockResolvedValue([
      { id: "nr-implement", nodeId: "implement", iterations: 0 },
      { id: "nr-typecheck", nodeId: "typecheck", iterations: 0 },
      { id: "nr-fix", nodeId: "fix", iterations: 0 },
    ] as any);
    engine = new CycleEngine(emitMock);
  });

  describe("startCycle", () => {
    it("creates a CycleRun and emits cycle.started", async () => {
      const run = await engine.startCycle(simpleBp, "thread-1", "/workspace");
      expect(prisma.cycleRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ blueprintId: "test-cycle", threadId: "thread-1" }),
        })
      );
      expect(emitMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "cycle.started" })
      );
    });
  });

  describe("advanceToNextNode", () => {
    it("advances past completed agentic node", async () => {
      vi.mocked(prisma.cycleRun.findFirst).mockResolvedValue({
        id: "run-1",
        blueprintId: "test-cycle",
        currentNodeIndex: 0,
        status: "running",
        threadId: "thread-1",
      } as any);

      const result = await engine.advanceAgenticNode("run-1", simpleBp, "/workspace");
      expect(result.nextNode?.id).toBe("typecheck");
    });
  });

  describe("runDeterministicNode", () => {
    it("runs gate checks and advances on success", async () => {
      vi.mocked(runGateChecks).mockResolvedValue([{ passed: true, summary: "OK" }]);

      const result = await engine.runDeterministicNode("run-1", simpleBp, 1, "/workspace");
      expect(result.passed).toBe(true);
      expect(runGateChecks).toHaveBeenCalled();
      // Verify currentNodeIndex was advanced past the deterministic node
      expect(prisma.cycleRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ currentNodeIndex: 2 }),
        })
      );
    });

    it("triggers fix loop on gate failure with retry", async () => {
      vi.mocked(runGateChecks).mockResolvedValue([{ passed: false, summary: "2 errors", errorCount: 2 }]);

      const result = await engine.runDeterministicNode("run-1", simpleBp, 1, "/workspace");
      expect(result.passed).toBe(false);
      expect(result.action).toBe("retry");
      expect(result.fixNodeId).toBe("fix");
    });
  });

  describe("fix loop iteration tracking", () => {
    it("stops after maxIterations", async () => {
      vi.mocked(runGateChecks).mockResolvedValue([{ passed: false, summary: "failing" }]);
      vi.mocked(prisma.cycleNodeResult.findMany).mockResolvedValue([
        { nodeId: "fix", iterations: 2 } as any,
      ]);

      const result = await engine.runDeterministicNode("run-1", simpleBp, 1, "/workspace");
      expect(result.action).toBe("halt");
    });
  });

  describe("skipCondition", () => {
    it("skips nodes when condition is met", () => {
      const skipCtx: SkipContext = { isSmallTask: true, isAutonomous: false, hasExistingTests: false, hasPrDiff: false };
      const node = { id: "spec", name: "Spec", type: "agentic" as const, skipCondition: "isSmallTask" };
      expect(engine.shouldSkip(node, skipCtx)).toBe(true);
    });

    it("does not skip when condition is not met", () => {
      const skipCtx: SkipContext = { isSmallTask: false, isAutonomous: false, hasExistingTests: false, hasPrDiff: false };
      const node = { id: "spec", name: "Spec", type: "agentic" as const, skipCondition: "isSmallTask" };
      expect(engine.shouldSkip(node, skipCtx)).toBe(false);
    });
  });

  describe("completeCycle", () => {
    it("marks cycle as completed", async () => {
      await engine.completeCycle("run-1");
      expect(prisma.cycleRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "run-1" },
          data: expect.objectContaining({ status: "completed" }),
        })
      );
    });
  });

  describe("failCycle", () => {
    it("marks cycle as gate_failed and emits cycle.failed", async () => {
      await engine.failCycle("run-1", "typecheck", "2 type errors");
      expect(prisma.cycleRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "run-1" },
          data: expect.objectContaining({ status: "gate_failed" }),
        })
      );
      expect(emitMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "cycle.failed", nodeId: "typecheck", reason: "2 type errors" })
      );
    });
  });

  describe("getPhasePrompt", () => {
    it("returns node prompt when defined", () => {
      const bp: Blueprint = {
        ...simpleBp,
        nodes: [{ id: "spec", name: "Spec", type: "agentic", prompt: "Write a spec" }],
      };
      expect(engine.getPhasePrompt(bp, 0)).toBe("Write a spec");
    });

    it("returns default prompt when no custom prompt", () => {
      const prompt = engine.getPhasePrompt(simpleBp, 0);
      expect(prompt).toContain("Implement");
    });

    it("returns fallback for out-of-bounds index", () => {
      expect(engine.getPhasePrompt(simpleBp, 99)).toBe("Continue with the task.");
    });
  });

  describe("iteration increment", () => {
    it("increments fix node iterations on retry", async () => {
      vi.mocked(runGateChecks).mockResolvedValue([{ passed: false, summary: "errors", errorCount: 1 }]);

      await engine.runDeterministicNode("run-1", simpleBp, 1, "/workspace");
      expect(prisma.cycleNodeResult.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "nr-fix" },
          data: { iterations: 1 },
        })
      );
    });
  });
});
