import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClaudeBackend } from "../src/agents/claude.js";
import type { AgentConfig, AgentEvent, AgentSession } from "@patchwork/shared";
import type { SidecarHttpClient } from "../src/agents/sidecar-client.js";

// --- Mock SidecarHttpClient ---

function createMockSidecarHttpClient(): SidecarHttpClient {
  return {
    exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
    gitDiff: vi.fn().mockResolvedValue(""),
    gitApply: vi.fn().mockResolvedValue({ success: true }),
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined),
    ptyStart: vi.fn().mockResolvedValue({ sessionId: "pty-123" }),
    ptyWrite: vi.fn().mockResolvedValue(undefined),
    ptyKill: vi.fn().mockResolvedValue(undefined),
  } as unknown as SidecarHttpClient;
}

// --- Mock WebSocket ---

class MockWebSocket {
  listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  readyState = 1; // OPEN

  on(event: string, cb: (...args: unknown[]) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(cb);
    return this;
  }

  emit(event: string, ...args: unknown[]) {
    for (const cb of this.listeners.get(event) ?? []) {
      cb(...args);
    }
  }

  close() {
    this.readyState = 3; // CLOSED
    this.emit("close");
  }
}

function defaultConfig(): AgentConfig {
  return {
    role: "implementer",
    budget: { maxTimeSeconds: 300 },
    allowedTools: ["file_read", "file_write", "shell"],
    systemContext: "You are an implementer.",
  };
}

describe("ClaudeBackend", () => {
  let sidecar: ReturnType<typeof createMockSidecarHttpClient>;
  let backend: ClaudeBackend;
  let mockWs: MockWebSocket;

  beforeEach(() => {
    sidecar = createMockSidecarHttpClient();
    mockWs = new MockWebSocket();
    backend = new ClaudeBackend(sidecar, () => mockWs as unknown as import("ws").WebSocket);
  });

  describe("startSession", () => {
    it("calls sidecar ptyStart with claude command", async () => {
      const session = await backend.startSession("devbox-1", defaultConfig());

      expect(sidecar.ptyStart).toHaveBeenCalledWith("claude", expect.any(Array));
      expect(session.id).toBe("pty-123");
      expect(session.devboxId).toBe("devbox-1");
      expect(session.runId).toBeDefined();
    });
  });

  describe("sendTask", () => {
    it("sends formatted prompt via ptyWrite", async () => {
      const session = await backend.startSession("devbox-1", defaultConfig());
      await backend.sendTask(session, "implement the feature");

      expect(sidecar.ptyWrite).toHaveBeenCalledWith(
        "pty-123",
        expect.stringContaining("implement the feature")
      );
      // Should include Patchwork constraints
      expect(sidecar.ptyWrite).toHaveBeenCalledWith(
        "pty-123",
        expect.stringContaining("PATCHWORK_DONE")
      );
    });
  });

  describe("events", () => {
    it("yields raw_pty events from WebSocket data", async () => {
      const session = await backend.startSession("devbox-1", defaultConfig());

      // Simulate WebSocket data arriving
      setTimeout(() => {
        mockWs.emit(
          "message",
          JSON.stringify({ type: "data", data: "hello from claude", timestamp: 1000 })
        );
        mockWs.emit(
          "message",
          JSON.stringify({ type: "data", data: "more output", timestamp: 1001 })
        );
        mockWs.close();
      }, 10);

      const collected: AgentEvent[] = [];
      for await (const event of backend.events(session)) {
        collected.push(event);
      }

      expect(collected.length).toBeGreaterThanOrEqual(2);
      expect(collected[0]).toEqual({
        type: "raw_pty",
        data: "hello from claude",
        timestamp: 1000,
      });
      expect(collected[1]).toEqual({
        type: "raw_pty",
        data: "more output",
        timestamp: 1001,
      });
    });

    it("yields done_marker when PATCHWORK_DONE detected in output", async () => {
      const session = await backend.startSession("devbox-1", defaultConfig());

      setTimeout(() => {
        mockWs.emit(
          "message",
          JSON.stringify({ type: "data", data: "working on it...", timestamp: 1000 })
        );
        mockWs.emit(
          "message",
          JSON.stringify({
            type: "data",
            data: "All done! PATCHWORK_DONE",
            timestamp: 1001,
          })
        );
      }, 10);

      const collected: AgentEvent[] = [];
      for await (const event of backend.events(session)) {
        collected.push(event);
        if (event.type === "done_marker") break;
      }

      const doneEvents = collected.filter((e) => e.type === "done_marker");
      expect(doneEvents.length).toBe(1);
    });

    it("yields done_marker on PTY exit when no explicit marker", async () => {
      const session = await backend.startSession("devbox-1", defaultConfig());

      setTimeout(() => {
        mockWs.emit(
          "message",
          JSON.stringify({ type: "data", data: "doing stuff", timestamp: 1000 })
        );
        mockWs.emit(
          "message",
          JSON.stringify({ type: "exit", exitCode: 0 })
        );
      }, 10);

      const collected: AgentEvent[] = [];
      for await (const event of backend.events(session)) {
        collected.push(event);
      }

      const lastEvent = collected[collected.length - 1];
      expect(lastEvent.type).toBe("done_marker");
    });

    it("yields error event on PTY exit with non-zero code", async () => {
      const session = await backend.startSession("devbox-1", defaultConfig());

      setTimeout(() => {
        mockWs.emit(
          "message",
          JSON.stringify({ type: "exit", exitCode: 1 })
        );
      }, 10);

      const collected: AgentEvent[] = [];
      for await (const event of backend.events(session)) {
        collected.push(event);
      }

      const errorEvents = collected.filter((e) => e.type === "error");
      expect(errorEvents.length).toBe(1);
      expect((errorEvents[0] as { type: "error"; message: string }).message).toContain(
        "exit code 1"
      );
    });

    it("yields budget_exceeded on timeout", async () => {
      // Use a very short timeout for testing
      const config = defaultConfig();
      config.budget.maxTimeSeconds = 0.05; // 50ms

      const session = await backend.startSession("devbox-1", config);

      // Don't send any done signal — let it timeout
      setTimeout(() => {
        mockWs.emit(
          "message",
          JSON.stringify({ type: "data", data: "working...", timestamp: 1000 })
        );
      }, 10);

      const collected: AgentEvent[] = [];
      for await (const event of backend.events(session)) {
        collected.push(event);
      }

      const budgetEvents = collected.filter((e) => e.type === "budget_exceeded");
      expect(budgetEvents.length).toBe(1);
    }, 5000);
  });

  describe("terminate", () => {
    it("calls sidecar ptyKill", async () => {
      const session = await backend.startSession("devbox-1", defaultConfig());
      await backend.terminate(session);

      expect(sidecar.ptyKill).toHaveBeenCalledWith("pty-123");
    });
  });
});
