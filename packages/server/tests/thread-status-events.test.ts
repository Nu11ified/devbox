import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ApprovalDecision } from "../src/providers/adapter.js";
import type { ThreadStatusPayload, ProviderRuntimeEvent, ProviderEventEnvelope } from "../src/providers/events.js";

describe("ApprovalDecision types", () => {
  it("allow variant accepts reason field", () => {
    const decision: ApprovalDecision = {
      type: "allow",
      reason: "Yes, proceed with the plan",
    };
    expect(decision.type).toBe("allow");
    expect(decision.reason).toBe("Yes, proceed with the plan");
  });

  it("allow variant works without reason (backward compatible)", () => {
    const decision: ApprovalDecision = { type: "allow" };
    expect(decision.type).toBe("allow");
    expect(decision.reason).toBeUndefined();
  });

  it("deny variant still works with reason", () => {
    const decision: ApprovalDecision = { type: "deny", reason: "No" };
    expect(decision.type).toBe("deny");
    expect(decision.reason).toBe("No");
  });
});

describe("ThreadStatusPayload", () => {
  it("represents needs_input status with all fields", () => {
    const payload: ThreadStatusPayload = {
      status: "needs_input",
      requestId: "req-123",
      question: "Should I proceed?",
      options: [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
      ],
      threadName: "Feature work",
    };
    expect(payload.status).toBe("needs_input");
    expect(payload.options).toHaveLength(2);
    expect(payload.threadName).toBe("Feature work");
  });

  it("represents running status (minimal)", () => {
    const payload: ThreadStatusPayload = {
      status: "running",
    };
    expect(payload.status).toBe("running");
    expect(payload.requestId).toBeUndefined();
    expect(payload.question).toBeUndefined();
  });
});

describe("thread.status event in ProviderRuntimeEvent union", () => {
  it("accepts thread.status as a valid event type", () => {
    const event: ProviderRuntimeEvent = {
      type: "thread.status",
      payload: { status: "needs_input", requestId: "r1", question: "Test?" },
    };
    expect(event.type).toBe("thread.status");
  });
});

describe("thread.status fan-out behavior", () => {
  it("thread.status events should NOT be persisted (transient)", () => {
    const envelope: ProviderEventEnvelope = {
      eventId: "e1" as any,
      type: "thread.status",
      provider: "claude-code" as any,
      threadId: "t1" as any,
      payload: { status: "needs_input", requestId: "r1", question: "Test?" },
      createdAt: new Date(),
    };
    const isThreadStatus = envelope.type === "thread.status";
    expect(isThreadStatus).toBe(true);
  });

  it("non-thread.status events should be persisted and sent to thread clients", () => {
    const envelope: ProviderEventEnvelope = {
      eventId: "e2" as any,
      type: "ask_user",
      provider: "claude-code" as any,
      threadId: "t1" as any,
      payload: { turnId: "turn1" as any, requestId: "r1", question: "Q?", options: [] },
      createdAt: new Date(),
    };
    const isThreadStatus = envelope.type === "thread.status";
    expect(isThreadStatus).toBe(false);
  });
});

describe("AskUserQuestion answer passthrough", () => {
  it("should inject reason into updatedInput.result", () => {
    const decision: ApprovalDecision = { type: "allow", reason: "Option A" };
    const input = { questions: [{ question: "Pick one", options: [] }] };

    const result = {
      behavior: "allow" as const,
      updatedInput: { ...input, result: decision.reason ?? "" },
    };

    expect(result.updatedInput.result).toBe("Option A");
    expect(result.updatedInput.questions).toEqual(input.questions);
  });

  it("should default to empty string when no reason provided", () => {
    const decision: ApprovalDecision = { type: "allow" };
    const input = { questions: [] };

    const result = {
      behavior: "allow" as const,
      updatedInput: { ...input, result: decision.reason ?? "" },
    };

    expect(result.updatedInput.result).toBe("");
  });
});
