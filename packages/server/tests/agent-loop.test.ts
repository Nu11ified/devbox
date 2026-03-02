import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentBackend, AgentConfig, AgentEvent, AgentSession } from "@patchwork/shared";
import type { SidecarClient } from "../src/agents/backend.js";
import { agentLoop } from "../src/agents/loop.js";

// --- Mock helpers ---

function createMockSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "session-1",
    runId: "run-1",
    devboxId: "devbox-1",
    config: {
      role: "implementer",
      budget: { maxTimeSeconds: 300 },
      allowedTools: ["file_read", "file_write", "shell"],
      systemContext: "test context",
    },
    ...overrides,
  };
}

function createMockSidecar(overrides: Partial<SidecarClient> = {}): SidecarClient {
  return {
    exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "ok", stderr: "" }),
    gitDiff: vi.fn().mockResolvedValue("diff --git a/file.ts"),
    gitApply: vi.fn().mockResolvedValue({ success: true }),
    readFile: vi.fn().mockResolvedValue("file content"),
    writeFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/**
 * Creates an async iterable from an array of AgentEvents.
 */
async function* eventsFromArray(events: AgentEvent[]): AsyncIterable<AgentEvent> {
  for (const event of events) {
    yield event;
  }
}

describe("agentLoop", () => {
  let session: AgentSession;
  let sidecar: SidecarClient;
  let recordEvent: ReturnType<typeof vi.fn>;
  let collectPatches: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    session = createMockSession();
    sidecar = createMockSidecar();
    recordEvent = vi.fn();
    collectPatches = vi.fn().mockResolvedValue([]);
  });

  it("forwards allowed tool calls to sidecar", async () => {
    const events: AgentEvent[] = [
      { type: "tool_call", tool: "shell", args: { cmd: "echo hi" } },
      { type: "done_marker" },
    ];

    const result = await agentLoop({
      session,
      events: eventsFromArray(events),
      sidecar,
      config: session.config,
      recordEvent,
      collectPatches,
    });

    expect(sidecar.exec).toHaveBeenCalled();
    expect(result.toolCallsForwarded).toBe(1);
    expect(result.toolCallsRejected).toBe(0);
    expect(result.exitReason).toBe("done");
  });

  it("rejects disallowed tool calls", async () => {
    const events: AgentEvent[] = [
      { type: "tool_call", tool: "dangerous_tool", args: {} },
      { type: "done_marker" },
    ];

    const result = await agentLoop({
      session,
      events: eventsFromArray(events),
      sidecar,
      config: session.config,
      recordEvent,
      collectPatches,
    });

    expect(sidecar.exec).not.toHaveBeenCalled();
    expect(result.toolCallsForwarded).toBe(0);
    expect(result.toolCallsRejected).toBe(1);
    expect(result.exitReason).toBe("done");
  });

  it("stops on done_marker and calls collectPatches", async () => {
    const events: AgentEvent[] = [
      { type: "message", content: "working on it..." },
      { type: "done_marker" },
      // This event should NOT be processed
      { type: "message", content: "should not see this" },
    ];

    collectPatches.mockResolvedValue([{ id: "patch-1", patchContent: "diff" }]);

    const result = await agentLoop({
      session,
      events: eventsFromArray(events),
      sidecar,
      config: session.config,
      recordEvent,
      collectPatches,
    });

    expect(collectPatches).toHaveBeenCalledOnce();
    expect(result.exitReason).toBe("done");
    // message + done_marker = 2 events processed (the third is never yielded since we break)
    expect(result.eventsProcessed).toBe(2);
  });

  it("stops on budget_exceeded", async () => {
    const events: AgentEvent[] = [
      { type: "message", content: "working..." },
      { type: "budget_exceeded", reason: "time" },
    ];

    const result = await agentLoop({
      session,
      events: eventsFromArray(events),
      sidecar,
      config: session.config,
      recordEvent,
      collectPatches,
    });

    expect(result.exitReason).toBe("budget_exceeded");
    expect(result.eventsProcessed).toBe(2);
  });

  it("records all events via recordEvent callback", async () => {
    const events: AgentEvent[] = [
      { type: "message", content: "hello" },
      { type: "tool_call", tool: "file_read", args: { path: "/foo" } },
      { type: "tool_result", tool: "file_read", result: "content" },
      { type: "done_marker" },
    ];

    await agentLoop({
      session,
      events: eventsFromArray(events),
      sidecar,
      config: session.config,
      recordEvent,
      collectPatches,
    });

    expect(recordEvent).toHaveBeenCalledTimes(4);
    expect(recordEvent).toHaveBeenNthCalledWith(1, session.runId, events[0]);
    expect(recordEvent).toHaveBeenNthCalledWith(2, session.runId, events[1]);
    expect(recordEvent).toHaveBeenNthCalledWith(3, session.runId, events[2]);
    expect(recordEvent).toHaveBeenNthCalledWith(4, session.runId, events[3]);
  });

  it("forwards file_read tool calls via sidecar.readFile", async () => {
    (sidecar.readFile as ReturnType<typeof vi.fn>).mockResolvedValue("file data");

    const events: AgentEvent[] = [
      { type: "tool_call", tool: "file_read", args: { path: "/workspace/foo.ts" } },
      { type: "done_marker" },
    ];

    const result = await agentLoop({
      session,
      events: eventsFromArray(events),
      sidecar,
      config: session.config,
      recordEvent,
      collectPatches,
    });

    expect(sidecar.readFile).toHaveBeenCalledWith("/workspace/foo.ts");
    expect(result.toolCallsForwarded).toBe(1);
  });

  it("forwards file_write tool calls via sidecar.writeFile", async () => {
    const events: AgentEvent[] = [
      {
        type: "tool_call",
        tool: "file_write",
        args: { path: "/workspace/foo.ts", content: "new content" },
      },
      { type: "done_marker" },
    ];

    const result = await agentLoop({
      session,
      events: eventsFromArray(events),
      sidecar,
      config: session.config,
      recordEvent,
      collectPatches,
    });

    expect(sidecar.writeFile).toHaveBeenCalledWith("/workspace/foo.ts", "new content");
    expect(result.toolCallsForwarded).toBe(1);
  });

  it("handles errors in event stream gracefully", async () => {
    const events: AgentEvent[] = [
      { type: "error", message: "something went wrong" },
      { type: "done_marker" },
    ];

    const result = await agentLoop({
      session,
      events: eventsFromArray(events),
      sidecar,
      config: session.config,
      recordEvent,
      collectPatches,
    });

    expect(result.exitReason).toBe("done");
    expect(result.eventsProcessed).toBe(2);
    expect(recordEvent).toHaveBeenCalledTimes(2);
  });

  it("returns stream_ended when event stream ends without done_marker", async () => {
    const events: AgentEvent[] = [
      { type: "message", content: "hello" },
      { type: "message", content: "goodbye" },
    ];

    const result = await agentLoop({
      session,
      events: eventsFromArray(events),
      sidecar,
      config: session.config,
      recordEvent,
      collectPatches,
    });

    expect(result.exitReason).toBe("stream_ended");
    expect(result.eventsProcessed).toBe(2);
    // collectPatches is still called on stream end
    expect(collectPatches).toHaveBeenCalledOnce();
  });
});
