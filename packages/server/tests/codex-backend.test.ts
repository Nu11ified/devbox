import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CodexBackend,
  type CodexSDK,
  type CodexEvent,
} from "../src/agents/codex.js";
import type { AgentConfig, AgentEvent } from "@patchwork/shared";
import type { SidecarClient } from "../src/agents/backend.js";

// --- Mock helpers ---

function createMockSidecar(): SidecarClient {
  return {
    exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
    gitDiff: vi.fn().mockResolvedValue(""),
    gitApply: vi.fn().mockResolvedValue({ success: true }),
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined),
  };
}

function defaultConfig(): AgentConfig {
  return {
    role: "implementer",
    budget: { maxTimeSeconds: 300 },
    allowedTools: ["file_read", "file_write", "shell"],
    systemContext: "You are an implementer.",
  };
}

async function* eventsFromArray(events: CodexEvent[]): AsyncIterable<CodexEvent> {
  for (const event of events) {
    yield event;
  }
}

function createMockCodexSDK(events: CodexEvent[]): CodexSDK {
  return {
    createThread: vi.fn().mockResolvedValue({ threadId: "thread-abc" }),
    runStreamed: vi.fn().mockReturnValue(eventsFromArray(events)),
    abort: vi.fn().mockResolvedValue(undefined),
  };
}

describe("CodexBackend", () => {
  let sidecar: SidecarClient;
  let config: AgentConfig;

  beforeEach(() => {
    sidecar = createMockSidecar();
    config = defaultConfig();
  });

  describe("startSession", () => {
    it("creates a Codex thread", async () => {
      const sdk = createMockCodexSDK([]);
      const backend = new CodexBackend(sdk, sidecar);

      const session = await backend.startSession("devbox-1", config);

      expect(sdk.createThread).toHaveBeenCalledWith({
        workingDirectory: "/workspace",
      });
      expect(session.id).toBe("thread-abc");
      expect(session.devboxId).toBe("devbox-1");
    });
  });

  describe("sendTask", () => {
    it("calls runStreamed with the prompt", async () => {
      const sdk = createMockCodexSDK([{ type: "turn.completed" }]);
      const backend = new CodexBackend(sdk, sidecar);

      const session = await backend.startSession("devbox-1", config);
      await backend.sendTask(session, "implement the feature");

      expect(sdk.runStreamed).toHaveBeenCalledWith(
        "thread-abc",
        expect.stringContaining("implement the feature")
      );
    });
  });

  describe("events", () => {
    it("maps Codex message events to AgentEvent message", async () => {
      const codexEvents: CodexEvent[] = [
        { type: "message", content: "I'll implement this feature" },
        { type: "turn.completed" },
      ];
      const sdk = createMockCodexSDK(codexEvents);
      const backend = new CodexBackend(sdk, sidecar);

      const session = await backend.startSession("devbox-1", config);
      await backend.sendTask(session, "implement feature");

      const collected: AgentEvent[] = [];
      for await (const event of backend.events(session)) {
        collected.push(event);
      }

      expect(collected[0]).toEqual({
        type: "message",
        content: "I'll implement this feature",
      });
    });

    it("maps Codex tool_call events to AgentEvent tool_call", async () => {
      const codexEvents: CodexEvent[] = [
        { type: "tool_call", name: "file_read", arguments: { path: "/foo.ts" } },
        { type: "turn.completed" },
      ];
      const sdk = createMockCodexSDK(codexEvents);
      const backend = new CodexBackend(sdk, sidecar);

      const session = await backend.startSession("devbox-1", config);
      await backend.sendTask(session, "read file");

      const collected: AgentEvent[] = [];
      for await (const event of backend.events(session)) {
        collected.push(event);
      }

      expect(collected[0]).toEqual({
        type: "tool_call",
        tool: "file_read",
        args: { path: "/foo.ts" },
      });
    });

    it("maps Codex tool_result events to AgentEvent tool_result", async () => {
      const codexEvents: CodexEvent[] = [
        { type: "tool_result", name: "file_read", output: "file contents" },
        { type: "turn.completed" },
      ];
      const sdk = createMockCodexSDK(codexEvents);
      const backend = new CodexBackend(sdk, sidecar);

      const session = await backend.startSession("devbox-1", config);
      await backend.sendTask(session, "read file");

      const collected: AgentEvent[] = [];
      for await (const event of backend.events(session)) {
        collected.push(event);
      }

      expect(collected[0]).toEqual({
        type: "tool_result",
        tool: "file_read",
        result: "file contents",
      });
    });

    it("maps Codex turn.completed to AgentEvent done_marker", async () => {
      const codexEvents: CodexEvent[] = [
        { type: "message", content: "done" },
        { type: "turn.completed" },
      ];
      const sdk = createMockCodexSDK(codexEvents);
      const backend = new CodexBackend(sdk, sidecar);

      const session = await backend.startSession("devbox-1", config);
      await backend.sendTask(session, "implement feature");

      const collected: AgentEvent[] = [];
      for await (const event of backend.events(session)) {
        collected.push(event);
      }

      const doneEvents = collected.filter((e) => e.type === "done_marker");
      expect(doneEvents.length).toBe(1);
    });

    it("handles a full sequence of Codex events", async () => {
      const codexEvents: CodexEvent[] = [
        { type: "message", content: "Let me read the file first" },
        { type: "tool_call", name: "file_read", arguments: { path: "/workspace/src/app.ts" } },
        { type: "tool_result", name: "file_read", output: "const app = express();" },
        { type: "message", content: "Now I'll write the fix" },
        { type: "tool_call", name: "file_write", arguments: { path: "/workspace/src/app.ts", content: "fixed" } },
        { type: "tool_result", name: "file_write", output: null },
        { type: "turn.completed" },
      ];
      const sdk = createMockCodexSDK(codexEvents);
      const backend = new CodexBackend(sdk, sidecar);

      const session = await backend.startSession("devbox-1", config);
      await backend.sendTask(session, "fix the bug");

      const collected: AgentEvent[] = [];
      for await (const event of backend.events(session)) {
        collected.push(event);
      }

      expect(collected).toHaveLength(7);
      expect(collected[0].type).toBe("message");
      expect(collected[1].type).toBe("tool_call");
      expect(collected[2].type).toBe("tool_result");
      expect(collected[3].type).toBe("message");
      expect(collected[4].type).toBe("tool_call");
      expect(collected[5].type).toBe("tool_result");
      expect(collected[6].type).toBe("done_marker");
    });
  });

  describe("terminate", () => {
    it("aborts the Codex thread", async () => {
      const sdk = createMockCodexSDK([]);
      const backend = new CodexBackend(sdk, sidecar);

      const session = await backend.startSession("devbox-1", config);
      await backend.terminate(session);

      expect(sdk.abort).toHaveBeenCalledWith("thread-abc");
    });
  });
});
