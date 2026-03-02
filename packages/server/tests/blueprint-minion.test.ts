import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AgentBackend, AgentConfig, AgentEvent, AgentSession, TaskSpec } from "@patchwork/shared";
import type { SidecarClient } from "../src/agents/backend.js";
import { BlueprintRunner } from "../src/blueprints/runner.js";
import { runMinionBlueprint } from "../src/blueprints/minion.js";
import { PatchStore } from "../src/patchwork/store.js";
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

function createMockBackend(type: "claude" | "codex" = "claude"): AgentBackend {
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
    yield { type: "message", content: "Working on it..." };
    yield { type: "done_marker" };
  }

  return {
    type,
    startSession: vi.fn().mockResolvedValue(mockSession),
    sendTask: vi.fn().mockResolvedValue(undefined),
    events: vi.fn().mockReturnValue(mockEvents()),
    terminate: vi.fn().mockResolvedValue(undefined),
  };
}

function createTaskSpec(overrides: Partial<TaskSpec> = {}): TaskSpec {
  return {
    description: "Implement feature X",
    repo: "test/repo",
    branch: "feature/x",
    templateId: "tpl-1",
    blueprintId: "minion",
    ...overrides,
  };
}

function createBackendFactory(backend?: AgentBackend) {
  const defaultBackend = backend ?? createMockBackend();
  return vi.fn().mockReturnValue(defaultBackend);
}

describe("runMinionBlueprint", () => {
  let runner: BlueprintRunner;
  let sidecar: SidecarClient;
  let patchStore: PatchStore;
  let taskSpec: TaskSpec;
  let testDir: string;

  beforeEach(async () => {
    runner = new BlueprintRunner();
    sidecar = createMockSidecar();
    taskSpec = createTaskSpec();
    testDir = path.join("/tmp", `patchwork-minion-test-${crypto.randomUUID()}`);
    await fs.mkdir(testDir, { recursive: true });
    patchStore = new PatchStore(testDir);
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("runs full happy path in correct order", async () => {
    const stepOrder: string[] = [];
    const origCreateStep = runner.createStep.bind(runner);
    vi.spyOn(runner, "createStep").mockImplementation(async (runId, nodeId, nodeType, agentRole?) => {
      stepOrder.push(nodeId);
      return origCreateStep(runId, nodeId, nodeType, agentRole);
    });

    // Lint passes on first try
    const execMock = sidecar.exec as ReturnType<typeof vi.fn>;
    execMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "npm" && args.includes("lint")) {
        return { exitCode: 0, stdout: "All clean", stderr: "" };
      }
      if (cmd === "npm" && args.includes("test")) {
        return { exitCode: 0, stdout: "Tests passed", stderr: "" };
      }
      if (cmd === "git" && args[0] === "push") {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      // gh run list → success
      if (cmd === "gh" && args.includes("run")) {
        return { exitCode: 0, stdout: "12345\tcompleted\tsuccess\thttps://ci/12345", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    const backendFactory = createBackendFactory();
    const result = await runMinionBlueprint(
      runner, "run-1", taskSpec, backendFactory, sidecar, patchStore
    );

    expect(stepOrder).toEqual([
      "checkout",
      "implement",
      "lint_check",
      "test",
      "review",
      "merge",
      "push",
      "ci_poll",
      "done",
    ]);
    expect(result.status).toBe("completed");
  });

  it("retries lint up to 3 times then fails", async () => {
    const execMock = sidecar.exec as ReturnType<typeof vi.fn>;
    let lintCallCount = 0;
    execMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "npm" && args.includes("lint")) {
        lintCallCount++;
        return { exitCode: 1, stdout: "", stderr: "lint error: no-unused-vars" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    const backendFactory = createBackendFactory();
    const result = await runMinionBlueprint(
      runner, "run-1", taskSpec, backendFactory, sidecar, patchStore
    );

    expect(lintCallCount).toBe(3);
    expect(result.status).toBe("failed");
  });

  it("retries CI fix once then fails", async () => {
    const execMock = sidecar.exec as ReturnType<typeof vi.fn>;
    let ciPollCount = 0;
    execMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "npm" && args.includes("lint")) {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (cmd === "npm" && args.includes("test")) {
        return { exitCode: 0, stdout: "ok", stderr: "" };
      }
      if (cmd === "git" && args[0] === "push") {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (cmd === "gh" && args.includes("run")) {
        ciPollCount++;
        if (args.includes("view")) {
          return { exitCode: 0, stdout: "FAIL test.ts\nError: assertion", stderr: "" };
        }
        // Always fail CI
        return { exitCode: 0, stdout: "12345\tcompleted\tfailure\thttps://ci/12345", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    const backendFactory = createBackendFactory();
    const result = await runMinionBlueprint(
      runner, "run-1", taskSpec, backendFactory, sidecar, patchStore
    );

    // 2 CI polls: initial + after fix attempt
    expect(ciPollCount).toBeGreaterThanOrEqual(2);
    expect(result.status).toBe("failed");
  });

  it("review step uses read-only tool allowlist", async () => {
    const execMock = sidecar.exec as ReturnType<typeof vi.fn>;
    execMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "npm" && args.includes("lint")) return { exitCode: 0, stdout: "", stderr: "" };
      if (cmd === "npm" && args.includes("test")) return { exitCode: 0, stdout: "", stderr: "" };
      if (cmd === "gh") return { exitCode: 0, stdout: "12345\tcompleted\tsuccess\thttps://ci/12345", stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    const mockBackend = createMockBackend();
    const backendFactory = vi.fn().mockReturnValue(mockBackend);
    await runMinionBlueprint(runner, "run-1", taskSpec, backendFactory, sidecar, patchStore);

    // Find the reviewer session creation
    const startSessionCalls = (mockBackend.startSession as ReturnType<typeof vi.fn>).mock.calls;
    const reviewerCall = startSessionCalls.find(
      (call: unknown[]) => (call[1] as AgentConfig).role === "reviewer"
    );
    expect(reviewerCall).toBeDefined();

    const reviewerConfig = reviewerCall![1] as AgentConfig;
    // Reviewer should only have read-only tools
    expect(reviewerConfig.allowedTools).not.toContain("file_write");
    expect(reviewerConfig.allowedTools).not.toContain("shell");
    expect(reviewerConfig.allowedTools).toContain("file_read");
  });

  it("each step creates a run_step record via runner", async () => {
    const execMock = sidecar.exec as ReturnType<typeof vi.fn>;
    execMock.mockImplementation(async (cmd: string, args: string[]) => {
      if (cmd === "npm" && args.includes("lint")) return { exitCode: 0, stdout: "", stderr: "" };
      if (cmd === "npm" && args.includes("test")) return { exitCode: 0, stdout: "", stderr: "" };
      if (cmd === "gh") return { exitCode: 0, stdout: "12345\tcompleted\tsuccess\thttps://ci/12345", stderr: "" };
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    const backendFactory = createBackendFactory();
    await runMinionBlueprint(runner, "run-1", taskSpec, backendFactory, sidecar, patchStore);

    const steps = runner.getSteps("run-1");
    expect(steps.length).toBeGreaterThanOrEqual(9);
    // All steps should be completed
    for (const step of steps) {
      expect(step.status).toBe("completed");
    }
  });
});
