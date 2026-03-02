import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AgentBackend, AgentConfig, AgentEvent, AgentSession, TaskSpec } from "@patchwork/shared";
import type { SidecarClient } from "../src/agents/backend.js";
import { BlueprintRunner } from "../src/blueprints/runner.js";
import { runSimpleBlueprint } from "../src/blueprints/simple.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";

// --- Mock helpers ---

function createMockSidecar(overrides: Partial<SidecarClient> = {}): SidecarClient {
  return {
    exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
    gitDiff: vi.fn().mockResolvedValue(""),
    gitApply: vi.fn().mockResolvedValue({ success: true }),
    readFile: vi.fn().mockRejectedValue(new Error("File not found")),
    writeFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockAgentBackend(): AgentBackend {
  const mockSession: AgentSession = {
    id: "session-1",
    runId: "run-1",
    devboxId: "devbox-1",
    config: {
      role: "implementer",
      budget: { maxTimeSeconds: 300 },
      allowedTools: ["shell", "file_read", "file_write"],
      systemContext: "test",
    },
  };

  async function* mockEvents(): AsyncIterable<AgentEvent> {
    yield { type: "message", content: "Working on it..." };
    yield { type: "done_marker" };
  }

  return {
    type: "claude",
    startSession: vi.fn().mockResolvedValue(mockSession),
    sendTask: vi.fn().mockResolvedValue(undefined),
    events: vi.fn().mockReturnValue(mockEvents()),
    terminate: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockTaskSpec(): TaskSpec {
  return {
    description: "Implement the foo feature",
    repo: "test/repo",
    branch: "feature/foo",
    templateId: "template-1",
    blueprintId: "simple",
  };
}

describe("BlueprintRunner", () => {
  let runner: BlueprintRunner;

  beforeEach(() => {
    runner = new BlueprintRunner();
  });

  it("creates a step record", async () => {
    const step = await runner.createStep("run-1", "implement", "agent", "implementer");

    expect(step.id).toBeDefined();
    expect(step.runId).toBe("run-1");
    expect(step.nodeId).toBe("implement");
    expect(step.nodeType).toBe("agent");
    expect(step.agentRole).toBe("implementer");
    expect(step.status).toBe("running");
    expect(step.startedAt).toBeDefined();
  });

  it("completes a step with output", async () => {
    const step = await runner.createStep("run-1", "lint", "deterministic");
    const completed = await runner.completeStep(step.id, { exitCode: 0 });

    expect(completed.status).toBe("completed");
    expect(completed.output).toEqual({ exitCode: 0 });
    expect(completed.endedAt).toBeDefined();
    expect(completed.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("updates run status", async () => {
    await runner.updateRunStatus("run-1", "running");
    const status = runner.getRunStatus("run-1");
    expect(status).toBe("running");
  });

  it("records transcript events", async () => {
    await runner.recordEvent("run-1", { type: "message", content: "hello" });
    const events = runner.getEvents("run-1");
    expect(events).toHaveLength(1);
    expect(events[0].content).toEqual({ type: "message", content: "hello" });
  });
});

describe("runSimpleBlueprint", () => {
  let runner: BlueprintRunner;
  let sidecar: SidecarClient;
  let agentBackend: AgentBackend;
  let taskSpec: TaskSpec;
  let testDir: string;

  beforeEach(async () => {
    runner = new BlueprintRunner();
    sidecar = createMockSidecar();
    agentBackend = createMockAgentBackend();
    taskSpec = createMockTaskSpec();
    testDir = path.join("/tmp", `patchwork-blueprint-test-${crypto.randomUUID()}`);
    await fs.mkdir(testDir, { recursive: true });

    // Mock exec calls for collector: rev-parse HEAD, ls patches
    (sidecar.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("executes the 3-step sequence in order", async () => {
    const stepOrder: string[] = [];
    const origCreateStep = runner.createStep.bind(runner);
    vi.spyOn(runner, "createStep").mockImplementation(async (runId, nodeId, nodeType, agentRole?) => {
      stepOrder.push(nodeId);
      return origCreateStep(runId, nodeId, nodeType, agentRole);
    });

    const result = await runSimpleBlueprint(runner, "run-1", taskSpec, agentBackend, sidecar, testDir);

    expect(stepOrder).toEqual(["implement", "lint", "review"]);
    expect(result.status).toBe("completed");
    expect(result.runId).toBe("run-1");
  });

  it("updates run status through lifecycle", async () => {
    await runSimpleBlueprint(runner, "run-1", taskSpec, agentBackend, sidecar, testDir);

    // Should have been set to running at start and completed at end
    expect(runner.getRunStatus("run-1")).toBe("completed");
  });

  it("calls agent backend for implement step", async () => {
    await runSimpleBlueprint(runner, "run-1", taskSpec, agentBackend, sidecar, testDir);

    expect(agentBackend.startSession).toHaveBeenCalled();
    expect(agentBackend.sendTask).toHaveBeenCalled();
  });

  it("runs lint as a deterministic step", async () => {
    await runSimpleBlueprint(runner, "run-1", taskSpec, agentBackend, sidecar, testDir);

    // Lint step should call sidecar.exec for npm run lint
    const execCalls = (sidecar.exec as ReturnType<typeof vi.fn>).mock.calls;
    const lintCall = execCalls.find(
      (call: unknown[]) => call[0] === "npm" && (call[1] as string[]).includes("lint")
    );
    expect(lintCall).toBeDefined();
  });

  it("sets status to failed when merge fails", async () => {
    // Make gitApply fail and exec fail for three-way merge
    (sidecar.gitApply as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false });
    (sidecar.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "conflict",
    });

    // Store a dummy patch to trigger merge
    const { PatchStore } = await import("../src/patchwork/store.js");
    const store = new PatchStore(testDir);
    await store.storePatch({
      id: "patch-1",
      runId: "run-1",
      stepId: "step-1",
      agentRole: "implementer",
      baseSha: "abc",
      repo: "test/repo",
      files: ["file.ts"],
      patchContent: "diff\n",
      metadata: {
        intentSummary: "test",
        confidence: "high",
        risks: [],
        followups: [],
      },
      createdAt: new Date(),
    });

    const result = await runSimpleBlueprint(runner, "run-1", taskSpec, agentBackend, sidecar, testDir);

    expect(result.status).toBe("failed");
  });
});
