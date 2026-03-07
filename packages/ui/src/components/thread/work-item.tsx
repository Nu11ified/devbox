"use client";

import { useState } from "react";
import { ChevronRight, Terminal, FileEdit, FileSearch, Plug, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

interface WorkItemProps {
  toolName: string;
  toolCategory: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  completed: boolean;
}

const categoryIcons: Record<string, typeof Terminal> = {
  command_execution: Terminal,
  file_change: FileEdit,
  file_read: FileSearch,
  mcp_tool_call: Plug,
  dynamic_tool_call: Wrench,
};

export function WorkItem({ toolName, toolCategory, input, output, error, completed }: WorkItemProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = categoryIcons[toolCategory] ?? Wrench;

  const summary = toolCategory === "command_execution"
    ? String(input.command ?? "")
    : toolCategory === "file_change" || toolCategory === "file_read"
    ? String(input.file_path ?? input.path ?? "")
    : toolName;

  return (
    <div className="border rounded-md bg-muted/20 border-border/30">
      <button
        className="flex items-center gap-2 w-full px-3 py-1.5 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          className={cn("h-3 w-3 text-muted-foreground/40 transition-transform", expanded && "rotate-90")}
        />
        <Icon className="h-3.5 w-3.5 text-muted-foreground/50" />
        <span className="text-xs font-mono text-muted-foreground truncate flex-1">
          {summary}
        </span>
        {!completed && (
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
        )}
        {error && (
          <span className="text-[10px] text-red-500 font-mono">error</span>
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-1">
          {toolCategory === "command_execution" && !!input.command && (
            <pre className="text-xs bg-black/80 text-green-400 rounded px-2 py-1.5 font-mono overflow-x-auto">
              $ {String(input.command)}
            </pre>
          )}
          {!!output && (
            <pre className="text-xs bg-muted/50 rounded px-2 py-1.5 font-mono overflow-x-auto max-h-48 overflow-y-auto">
              {typeof output === "string" ? output : JSON.stringify(output, null, 2)}
            </pre>
          )}
          {error && (
            <pre className="text-xs text-red-400 bg-red-500/5 rounded px-2 py-1.5 font-mono">
              {error}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
