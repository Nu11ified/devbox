"use client";

import { useState } from "react";
import { ChevronRight, Terminal, FileEdit, FileSearch, Plug, Wrench, Check, Loader2, X } from "lucide-react";
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

const categoryColors: Record<string, string> = {
  command_execution: "text-green-500/70",
  file_change: "text-blue-500/70",
  file_read: "text-cyan-500/70",
  mcp_tool_call: "text-purple-500/70",
  dynamic_tool_call: "text-muted-foreground/50",
};

export function WorkItem({ toolName, toolCategory, input, output, error, completed }: WorkItemProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = categoryIcons[toolCategory] ?? Wrench;
  const iconColor = categoryColors[toolCategory] ?? "text-muted-foreground/50";

  const summary = toolCategory === "command_execution"
    ? String(input.command ?? "")
    : toolCategory === "file_change" || toolCategory === "file_read"
    ? String(input.file_path ?? input.path ?? "")
    : toolName;

  return (
    <div className="ml-10 border rounded-lg bg-muted/5 border-border/20 overflow-hidden">
      <button
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-muted/10 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          className={cn("h-3 w-3 text-muted-foreground/30 transition-transform shrink-0", expanded && "rotate-90")}
        />
        <Icon className={cn("h-3.5 w-3.5 shrink-0", iconColor)} />
        <span className="text-xs font-mono text-muted-foreground/70 truncate flex-1">
          {summary}
        </span>
        {!completed ? (
          <Loader2 className="h-3 w-3 text-blue-500 animate-spin shrink-0" />
        ) : error ? (
          <X className="h-3 w-3 text-red-500 shrink-0" />
        ) : (
          <Check className="h-3 w-3 text-green-500/50 shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-2.5 space-y-1.5 border-t border-border/10">
          {toolCategory === "command_execution" && !!input.command && (
            <pre className="text-[11px] bg-[#0d1117] text-green-400/90 rounded-md px-3 py-2 font-mono overflow-x-auto mt-1.5">
              $ {String(input.command)}
            </pre>
          )}
          {!!output && (
            <pre className="text-[11px] bg-muted/20 text-foreground/70 rounded-md px-3 py-2 font-mono overflow-x-auto max-h-48 overflow-y-auto">
              {typeof output === "string" ? output : JSON.stringify(output, null, 2)}
            </pre>
          )}
          {error && (
            <pre className="text-[11px] text-red-400 bg-red-500/5 rounded-md px-3 py-2 font-mono overflow-x-auto">
              {error}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
