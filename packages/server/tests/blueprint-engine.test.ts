import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  AgentBackend,
  AgentConfig,
  AgentEvent,
  AgentSession,
  TaskSpec,
  BlueprintDefinition,
  BlueprintNode,
  BlueprintEdge,
} from "@patchwork/shared";
import type { SidecarClient } from "../src/agents/backend.js";
import { BlueprintRunner } from "../src/blueprints/runner.js";
import { BlueprintEngine } from "../src/blueprints/engine.js";
import { SIMPLE_BLUEPRINT, MINION_BLUEPRINT, BUILTIN_BLUEPRINTS } from "../src/blueprints/definitions.js";
import { PatchStore } from "../src/patchwork/store.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";

// --- Helpers ---

function createMockSidecar(): SidecarClient {
  return {
    exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
    gitDiff: vi.fn().mockResolvedValue(""),
    gitApply: vi.fn().mockResolvedValue({ success: true }),
    readFile: vi.fn().mockRejectedValue(new Error("File not found")),
    writeFile: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockBackend(): AgentBackend {
  const mockSession: AgentSession = {
    id: `session-${crypto.randomUUID()}`,
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
    yield { type: "message", content: "Working..." };
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

function createTaskSpec(): TaskSpec {
  return {
    description: "Implement feature X",
    repo: "test/repo",
    branch: "feature/x",
    templateId: "tpl-1",
    blueprintId: "test",
  };
}

// A small 3-node linear blueprint for testing
function createLinearBlueprint(): BlueprintDefinition {
  return {
    id: "test-linear",
    name: "Test Linear",
    version: 1,
    description: "A simple 3-node linear blueprint for testing",
    nodes: [
      {
        id: "step_a",
        type: "deterministic",
        label: "Step A",
        command: "echo step-a",
      },
      {
        id: "step_b",
        type: "agent",
        label: "Step B",
        agentConfig: {
          preferredBackends: ["claude"],
          role: "implementer",
          promptTemplate: "Implement: {{task_description}}",
          systemContextTemplate: "You are an implementer for {{repo}}",
          allowedTools: ["file_read", "file_write"],
          budget: { maxTimeSeconds: 60 },
        },
      },
      {
        id: "step_c",
        type: "deterministic",
        label: "Step C",
        command: "echo step-c",
      },
    ],
    edges: [
      { from: "step_a", to: "step_b", condition: "always" },
      { from: "step_b", to: "step_c", condition: "on_success" },
    ],
  };
}

// Blueprint with conditional edges
function createConditionalBlueprint(): BlueprintDefinition {
  return {
    id: "test-conditional",
    name: "Test Conditional",
    version: 1,
    description: "Blueprint with conditional edges",
    nodes: [
      { id: "check", type: "deterministic", label: "Check", command: "npm run lint" },
      { id: "fix", type: "agent", label: "Fix", agentConfig: {
        preferredBackends: ["claude"],
        role: "ci_fixer",
        promptTemplate: "Fix: {{task_description}}",
        systemContextTemplate: "Fix errors",
        allowedTools: ["file_read", "file_write"],
        budget: { maxTimeSeconds: 60 },
      }},
      { id: "done", type: "deterministic", label: "Done", command: "echo done" },
    ],
    edges: [
      { from: "check", to: "done", condition: "on_success" },
      { from: "check", to: "fix", condition: "on_failure" },
      { from: "fix", to: "check", condition: "always" },
    ],
  };
}

// Blueprint with retry loop
function createRetryBlueprint(): BlueprintDefinition {
  return {
    id: "test-retry",
    name: "Test Retry",
    version: 1,
    description: "Blueprint with retry loop",
    nodes: [
      { id: "lint", type: "deterministic", label: "Lint", command: "npm run lint",
        retryPolicy: { maxRetries: 2, backoffMs: 0 } },
      { id: "fix", type: "agent", label: "Fix Lint", agentConfig: {
        preferredBackends: ["claude"],
        role: "ci_fixer",
        promptTemplate: "Fix lint errors",
        systemContextTemplate: "Fix errors",
        allowedTools: ["file_read", "file_write"],
        budget: { maxTimeSeconds: 60 },
      }},
      { id: "done", type: "deterministic", label: "Done", command: "echo done" },
    ],
    edges: [
      { from: "lint", to: "done", condition: "on_success" },
      { from: "lint", to: "fix", condition: "on_failure" },
      { from: "fix", to: "lint", condition: "always" },
    ],
  };
}

describe("BlueprintEngine", () => {
  let engine: BlueprintEngine;
  let runner: BlueprintRunner;
  let sidecar: SidecarClient;
  let patchStore: PatchStore;
  let taskSpec: TaskSpec;
  let testDir: string;

  beforeEach(async () => {
    engine = new BlueprintEngine();
    runner = new BlueprintRunner();
    sidecar = createMockSidecar();
    taskSpec = createTaskSpec();
    testDir = path.join("/tmp", `patchwork-engine-test-${crypto.randomUUID()}`);
    await fs.mkdir(testDir, { recursive: true });
    patchStore = new PatchStore(testDir);
  });

  it("executes a linear 3-node blueprint in topological order", async () => {
    const nodeOrder: string[] = [];
    const origCreateStep = runner.createStep.bind(runner);
    vi.spyOn(runner, "createStep").mockImplementation(async (runId, nodeId, nodeType, agentRole?) => {
      nodeOrder.push(nodeId);
      return origCreateStep(runId, nodeId, nodeType, agentRole);
    });

    const blueprint = createLinearBlueprint();
    const backendFactory = vi.fn().mockReturnValue(createMockBackend());

    const result = await engine.execute(
      blueprint, runner, "run-1", taskSpec, backendFactory, sidecar, patchStore
    );

    expect(nodeOrder).toEqual(["step_a", "step_b", "step_c"]);
    expect(result.status).toBe("completed");
  });

  it("follows on_success edge when deterministic step succeeds", async () => {
    const blueprint = createConditionalBlueprint();
    (sidecar.exec as ReturnType<typeof vi.fn>).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

    const nodeOrder: string[] = [];
    const origCreateStep = runner.createStep.bind(runner);
    vi.spyOn(runner, "createStep").mockImplementation(async (runId, nodeId, nodeType, agentRole?) => {
      nodeOrder.push(nodeId);
      return origCreateStep(runId, nodeId, nodeType, agentRole);
    });

    const backendFactory = vi.fn().mockReturnValue(createMockBackend());
    await engine.execute(blueprint, runner, "run-1", taskSpec, backendFactory, sidecar, patchStore);

    expect(nodeOrder).toEqual(["check", "done"]);
  });

  it("follows on_failure edge when deterministic step fails", async () => {
    let checkCount = 0;
    (sidecar.exec as ReturnType<typeof vi.fn>).mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "npm" && args.includes("lint")) {
        checkCount++;
        // Fail first time, succeed second time
        return checkCount <= 1
          ? { exitCode: 1, stdout: "", stderr: "lint error" }
          : { exitCode: 0, stdout: "", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    const nodeOrder: string[] = [];
    const origCreateStep = runner.createStep.bind(runner);
    vi.spyOn(runner, "createStep").mockImplementation(async (runId, nodeId, nodeType, agentRole?) => {
      nodeOrder.push(nodeId);
      return origCreateStep(runId, nodeId, nodeType, agentRole);
    });

    const blueprint = createConditionalBlueprint();
    const backendFactory = vi.fn().mockReturnValue(createMockBackend());
    await engine.execute(blueprint, runner, "run-1", taskSpec, backendFactory, sidecar, patchStore);

    // check → fix → check → done
    expect(nodeOrder).toEqual(["check", "fix", "check", "done"]);
  });

  it("enforces retry limits on loop edges", async () => {
    // Lint always fails
    (sidecar.exec as ReturnType<typeof vi.fn>).mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "npm" && args.includes("lint")) {
        return { exitCode: 1, stdout: "", stderr: "lint error" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    const blueprint = createRetryBlueprint();
    const backendFactory = vi.fn().mockReturnValue(createMockBackend());
    const result = await engine.execute(blueprint, runner, "run-1", taskSpec, backendFactory, sidecar, patchStore);

    // Should have hit the retry limit and failed
    expect(result.status).toBe("failed");
  });

  it("expands prompt templates with task variables", async () => {
    const blueprint = createLinearBlueprint();
    const mockBackend = createMockBackend();
    const backendFactory = vi.fn().mockReturnValue(mockBackend);

    await engine.execute(blueprint, runner, "run-1", taskSpec, backendFactory, sidecar, patchStore);

    const sendTaskCalls = (mockBackend.sendTask as ReturnType<typeof vi.fn>).mock.calls;
    expect(sendTaskCalls.length).toBeGreaterThan(0);
    // The prompt should have been expanded with task_description
    const prompt = sendTaskCalls[0][1] as string;
    expect(prompt).toContain("Implement feature X");
  });
});

describe("Built-in blueprints", () => {
  it("SIMPLE_BLUEPRINT has 3 nodes", () => {
    expect(SIMPLE_BLUEPRINT.nodes).toHaveLength(3);
    expect(SIMPLE_BLUEPRINT.nodes.map((n) => n.id)).toEqual(["implement", "lint", "review"]);
  });

  it("MINION_BLUEPRINT has all expected nodes", () => {
    const nodeIds = MINION_BLUEPRINT.nodes.map((n) => n.id);
    expect(nodeIds).toContain("checkout");
    expect(nodeIds).toContain("implement");
    expect(nodeIds).toContain("lint_check");
    expect(nodeIds).toContain("lint_fix");
    expect(nodeIds).toContain("test");
    expect(nodeIds).toContain("review");
    expect(nodeIds).toContain("merge");
    expect(nodeIds).toContain("push");
    expect(nodeIds).toContain("ci_poll");
    expect(nodeIds).toContain("ci_fix");
    expect(nodeIds).toContain("done");
  });

  it("BUILTIN_BLUEPRINTS contains both blueprints", () => {
    expect(BUILTIN_BLUEPRINTS.get("simple")).toBe(SIMPLE_BLUEPRINT);
    expect(BUILTIN_BLUEPRINTS.get("minion")).toBe(MINION_BLUEPRINT);
  });

  it("MINION_BLUEPRINT has lint retry policy", () => {
    const lintCheck = MINION_BLUEPRINT.nodes.find((n) => n.id === "lint_check");
    expect(lintCheck?.retryPolicy).toBeDefined();
    expect(lintCheck?.retryPolicy?.maxRetries).toBe(3);
  });

  it("MINION_BLUEPRINT has ci retry policy", () => {
    const ciPoll = MINION_BLUEPRINT.nodes.find((n) => n.id === "ci_poll");
    expect(ciPoll?.retryPolicy).toBeDefined();
    expect(ciPoll?.retryPolicy?.maxRetries).toBe(1);
  });
});
