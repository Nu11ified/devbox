import type { TimelineItem } from "./timeline";

/**
 * Groups consecutive work_item timeline entries into tool_group items.
 * Groups are bounded by:
 * - Non-work-item entries (text, approval_request, ask_user, context_compacted, todo_progress)
 * - turnId changes (groups must not span turns)
 *
 * Error items within a tool sequence stay inside the group if they have a toolName (tool-level errors).
 * Runtime errors (no toolName) break the group.
 */
export function groupTimelineItems(items: TimelineItem[]): TimelineItem[] {
  const result: TimelineItem[] = [];
  let currentGroup: TimelineItem[] = [];
  let groupTurnId: string | undefined;

  function flushGroup() {
    if (currentGroup.length === 0) return;
    const categories: Record<string, number> = {};
    for (const item of currentGroup) {
      if (item.kind === "work_item" && item.toolCategory) {
        categories[item.toolCategory] = (categories[item.toolCategory] || 0) + 1;
      }
    }
    result.push({
      id: `group-${currentGroup[0].id}`,
      kind: "tool_group",
      groupItems: currentGroup,
      categories,
      turnId: groupTurnId,
    });
    currentGroup = [];
    groupTurnId = undefined;
  }

  for (const item of items) {
    if (item.kind === "work_item") {
      // Close group if turnId changed
      if (currentGroup.length > 0 && item.turnId !== groupTurnId) {
        flushGroup();
      }
      currentGroup.push(item);
      groupTurnId = item.turnId;
    } else if (item.kind === "error" && currentGroup.length > 0) {
      // Tool-level errors (have a toolName) stay in the group as failed children.
      // Runtime errors (no toolName) break the group — they're system-level.
      if (item.toolName) {
        currentGroup.push(item);
      } else {
        flushGroup();
        result.push(item);
      }
    } else {
      // Everything else breaks the group
      flushGroup();
      result.push(item);
    }
  }
  flushGroup();

  return result;
}
