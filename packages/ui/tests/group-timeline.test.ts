import { describe, it, expect, beforeEach } from "vitest";
import { groupTimelineItems } from "../src/components/thread/group-timeline";
import type { TimelineItem } from "../src/components/thread/timeline";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _id = 0;
function nextId(): string {
  return `item-${++_id}`;
}

function workItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: nextId(),
    kind: "work_item",
    toolName: "bash",
    toolCategory: "shell",
    turnId: "turn-1",
    ...overrides,
  };
}

function textItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: nextId(),
    kind: "assistant_text",
    content: "hello",
    turnId: "turn-1",
    ...overrides,
  };
}

function userMessage(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: nextId(),
    kind: "user_message",
    content: "do the thing",
    ...overrides,
  };
}

function errorItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: nextId(),
    kind: "error",
    error: "something went wrong",
    ...overrides,
  };
}

function approvalRequest(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: nextId(),
    kind: "approval_request",
    description: "approve this?",
    turnId: "turn-1",
    ...overrides,
  };
}

function askUser(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: nextId(),
    kind: "ask_user",
    question: "what should I do?",
    turnId: "turn-1",
    ...overrides,
  };
}

function contextCompacted(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: nextId(),
    kind: "context_compacted",
    turnId: "turn-1",
    ...overrides,
  };
}

// Reset auto-id counter before each suite to keep snapshots stable.
beforeEach(() => {
  _id = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("groupTimelineItems", () => {
  // 1. Empty input
  it("returns empty array for empty input", () => {
    expect(groupTimelineItems([])).toEqual([]);
  });

  // 2. Non-work items pass through unchanged
  it("passes text-only items through unchanged", () => {
    const a = textItem();
    const b = userMessage();
    const result = groupTimelineItems([a, b]);
    expect(result).toEqual([a, b]);
  });

  // 3. Consecutive work_items get grouped into a single tool_group
  it("groups consecutive work_items into one tool_group", () => {
    const w1 = workItem({ turnId: "t1" });
    const w2 = workItem({ turnId: "t1" });
    const w3 = workItem({ turnId: "t1" });
    const result = groupTimelineItems([w1, w2, w3]);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("tool_group");
    expect(result[0].groupItems).toEqual([w1, w2, w3]);
  });

  // 4. Text between work_items creates separate groups
  it("creates separate groups when text items appear between work_items", () => {
    const w1 = workItem({ turnId: "t1" });
    const txt = textItem();
    const w2 = workItem({ turnId: "t1" });

    const result = groupTimelineItems([w1, txt, w2]);

    expect(result).toHaveLength(3);
    expect(result[0].kind).toBe("tool_group");
    expect(result[0].groupItems).toEqual([w1]);
    expect(result[1]).toEqual(txt);
    expect(result[2].kind).toBe("tool_group");
    expect(result[2].groupItems).toEqual([w2]);
  });

  // 5. Single work_item is still wrapped in a group
  it("wraps a single work_item in a tool_group", () => {
    const w = workItem();
    const result = groupTimelineItems([w]);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("tool_group");
    expect(result[0].groupItems).toEqual([w]);
  });

  // 6. turnId change flushes the current group and starts a new one
  it("starts a new group when turnId changes within consecutive work_items", () => {
    const w1 = workItem({ turnId: "t1" });
    const w2 = workItem({ turnId: "t2" });

    const result = groupTimelineItems([w1, w2]);

    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe("tool_group");
    expect(result[0].groupItems).toEqual([w1]);
    expect(result[0].turnId).toBe("t1");
    expect(result[1].kind).toBe("tool_group");
    expect(result[1].groupItems).toEqual([w2]);
    expect(result[1].turnId).toBe("t2");
  });

  // 7. approval_request breaks the group
  it("flushes active group when an approval_request is encountered", () => {
    const w = workItem({ turnId: "t1" });
    const ar = approvalRequest();

    const result = groupTimelineItems([w, ar]);

    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe("tool_group");
    expect(result[1]).toEqual(ar);
  });

  // 8. ask_user breaks the group
  it("flushes active group when an ask_user item is encountered", () => {
    const w = workItem({ turnId: "t1" });
    const au = askUser();

    const result = groupTimelineItems([w, au]);

    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe("tool_group");
    expect(result[1]).toEqual(au);
  });

  // 9. context_compacted breaks the group
  it("flushes active group when a context_compacted item is encountered", () => {
    const w = workItem({ turnId: "t1" });
    const cc = contextCompacted();

    const result = groupTimelineItems([w, cc]);

    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe("tool_group");
    expect(result[1]).toEqual(cc);
  });

  // 10. Error with toolName stays inside the group
  it("keeps an error with toolName inside the active group", () => {
    const w = workItem({ turnId: "t1" });
    const err = errorItem({ toolName: "bash", turnId: "t1" });

    const result = groupTimelineItems([w, err]);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("tool_group");
    expect(result[0].groupItems).toEqual([w, err]);
  });

  // 11. Error without toolName breaks the group
  it("flushes active group when an error without toolName is encountered", () => {
    const w = workItem({ turnId: "t1" });
    const err = errorItem(); // no toolName

    const result = groupTimelineItems([w, err]);

    expect(result).toHaveLength(2);
    expect(result[0].kind).toBe("tool_group");
    expect(result[1]).toEqual(err);
  });

  // 12. Error without toolName when no active group passes through at top level
  it("passes an error through unchanged when there is no active group", () => {
    const err = errorItem(); // no toolName, no preceding work_items
    const result = groupTimelineItems([err]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(err);
  });

  // 13. Category counting
  it("counts toolCategory occurrences correctly across grouped work_items", () => {
    const w1 = workItem({ toolCategory: "shell" });
    const w2 = workItem({ toolCategory: "shell" });
    const w3 = workItem({ toolCategory: "file" });
    const w4 = workItem({ toolCategory: "file" });
    const w5 = workItem({ toolCategory: "file" });
    // No toolCategory — should not appear in categories
    const w6 = workItem({ toolCategory: undefined });

    const result = groupTimelineItems([w1, w2, w3, w4, w5, w6]);

    expect(result).toHaveLength(1);
    expect(result[0].categories).toEqual({ shell: 2, file: 3 });
  });

  // 14. Group id format
  it("sets the group id to `group-<firstItemId>`", () => {
    const w1 = workItem({ id: "abc" });
    const w2 = workItem({ id: "def" });

    const result = groupTimelineItems([w1, w2]);

    expect(result[0].id).toBe("group-abc");
  });

  // Additional: turnId propagated to the group
  it("propagates turnId from the work_items to the tool_group", () => {
    const w = workItem({ turnId: "my-turn" });
    const result = groupTimelineItems([w]);

    expect(result[0].turnId).toBe("my-turn");
  });

  // Additional: interleaved text + work pattern (text → group → text → group)
  it("handles text → work → text → work sequence correctly", () => {
    const txt1 = textItem();
    const w1 = workItem({ turnId: "t1" });
    const txt2 = textItem();
    const w2 = workItem({ turnId: "t2" });

    const result = groupTimelineItems([txt1, w1, txt2, w2]);

    expect(result).toHaveLength(4);
    expect(result[0]).toEqual(txt1);
    expect(result[1].kind).toBe("tool_group");
    expect(result[1].groupItems).toEqual([w1]);
    expect(result[2]).toEqual(txt2);
    expect(result[3].kind).toBe("tool_group");
    expect(result[3].groupItems).toEqual([w2]);
  });
});
