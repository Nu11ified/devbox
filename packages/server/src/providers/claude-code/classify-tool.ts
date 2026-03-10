import type { ToolCategory } from "../events.js";

const COMMAND_TOOLS = new Set(["bash", "shell", "Bash", "computer"]);
const FILE_CHANGE_TOOLS = new Set(["edit", "write", "Write", "Edit", "NotebookEdit"]);
const FILE_READ_TOOLS = new Set(["read", "Read", "Glob", "Grep", "LS"]);
const TODO_TOOLS = new Set(["TodoWrite", "TodoRead"]);
const SUBAGENT_TOOLS = new Set(["Agent", "Skill"]);

export function classifyTool(toolName: string): ToolCategory {
  if (COMMAND_TOOLS.has(toolName)) return "command_execution";
  if (FILE_CHANGE_TOOLS.has(toolName)) return "file_change";
  if (FILE_READ_TOOLS.has(toolName)) return "file_read";
  if (TODO_TOOLS.has(toolName)) return "todo_tracking";
  if (SUBAGENT_TOOLS.has(toolName)) return "subagent";
  if (toolName.startsWith("mcp__") || toolName.startsWith("mcp_")) return "mcp_tool_call";
  if (toolName.startsWith("patchwork_")) return "mcp_tool_call"; // Custom Patchwork tools
  return "dynamic_tool_call";
}
