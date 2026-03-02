import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentBackend, AgentConfig, AgentSession, AgentEvent, TaskSpec } from "@patchwork/shared";
import { AgentRouter } from "../src/agents/router.js";

function createMockBackend(type: "claude" | "codex"): AgentBackend {
  return {
    type,
    startSession: vi.fn().mockResolvedValue({
      id: "session-1",
      runId: "run-1",
      devboxId: "devbox-1",
      config: {} as AgentConfig,
    }),
    sendTask: vi.fn().mockResolvedValue(undefined),
    events: vi.fn().mockReturnValue((async function* () {})()),
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

describe("AgentRouter", () => {
  let claude: AgentBackend;
  let codex: AgentBackend;
  let router: AgentRouter;

  beforeEach(() => {
    claude = createMockBackend("claude");
    codex = createMockBackend("codex");
    router = new AgentRouter(new Map([
      ["claude", claude],
      ["codex", codex],
    ]));
  });

  describe("selectBackend", () => {
    it("uses user-specified preferredBackend when set", () => {
      const task = createTaskSpec({ preferredBackend: "codex" });
      const backend = router.selectBackend(task, "implementer");
      expect(backend).toBe(codex);
    });

    it("returns claude for implementer role by default", () => {
      const task = createTaskSpec();
      const backend = router.selectBackend(task, "implementer");
      expect(backend).toBe(claude);
    });

    it("returns codex for reviewer role by default", () => {
      const task = createTaskSpec();
      const backend = router.selectBackend(task, "reviewer");
      expect(backend).toBe(codex);
    });

    it("returns claude for ci_fixer role by default", () => {
      const task = createTaskSpec();
      const backend = router.selectBackend(task, "ci_fixer");
      expect(backend).toBe(claude);
    });

    it("detects Python in task description and prefers codex", () => {
      const task = createTaskSpec({ description: "Fix the Python test suite" });
      const backend = router.selectBackend(task, "implementer");
      expect(backend).toBe(codex);
    });

    it("falls back to first available backend when preferred is not found", () => {
      const task = createTaskSpec({ preferredBackend: "codex" });
      const routerWithOnlyClaude = new AgentRouter(new Map([["claude", claude]]));
      const backend = routerWithOnlyClaude.selectBackend(task, "implementer");
      expect(backend).toBe(claude);
    });

    it("throws when no backends are registered", () => {
      const emptyRouter = new AgentRouter(new Map());
      const task = createTaskSpec();
      expect(() => emptyRouter.selectBackend(task, "implementer")).toThrow(
        "No agent backends available"
      );
    });
  });

  describe("registerBackend", () => {
    it("adds a new backend", () => {
      const newRouter = new AgentRouter(new Map());
      newRouter.registerBackend("claude", claude);
      expect(newRouter.getAvailableBackends()).toEqual(["claude"]);
    });

    it("overwrites an existing backend with the same name", () => {
      const newClaude = createMockBackend("claude");
      router.registerBackend("claude", newClaude);
      const task = createTaskSpec({ preferredBackend: "claude" });
      expect(router.selectBackend(task, "implementer")).toBe(newClaude);
    });
  });

  describe("getAvailableBackends", () => {
    it("returns all registered backend names", () => {
      const names = router.getAvailableBackends();
      expect(names).toEqual(expect.arrayContaining(["claude", "codex"]));
      expect(names).toHaveLength(2);
    });

    it("returns empty array when no backends registered", () => {
      const emptyRouter = new AgentRouter(new Map());
      expect(emptyRouter.getAvailableBackends()).toEqual([]);
    });
  });
});
