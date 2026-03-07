import type { ToolCategory } from "../events.js";

const COMMAND_TOOLS = new Set(["bash", "shell", "Bash", "computer"]);
const FILE_CHANGE_TOOLS = new Set(["edit", "write", "Write", "Edit", "NotebookEdit"]);
const FILE_READ_TOOLS = new Set(["read", "Read", "Glob", "Grep", "LS"]);

export function classifyTool(toolName: string): ToolCategory {
  if (COMMAND_TOOLS.has(toolName)) return "command_execution";
  if (FILE_CHANGE_TOOLS.has(toolName)) return "file_change";
  if (FILE_READ_TOOLS.has(toolName)) return "file_read";
  if (toolName.startsWith("mcp__") || toolName.startsWith("mcp_")) return "mcp_tool_call";
  return "dynamic_tool_call";
}
