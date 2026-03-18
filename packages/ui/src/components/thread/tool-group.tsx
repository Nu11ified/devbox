"use client";

import { useState } from "react";
import {
  ChevronRight,
  Terminal,
  FileEdit,
  FileSearch,
  Plug,
  Wrench,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkItem } from "./work-item";
import type { TimelineItem } from "./timeline";

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

const categoryLabels: Record<string, (n: number) => string> = {
  command_execution: (n) => `${n} command${n > 1 ? "s" : ""}`,
  file_change: (n) => `${n} file edit${n > 1 ? "s" : ""}`,
  file_read: (n) => `${n} file read${n > 1 ? "s" : ""}`,
  mcp_tool_call: (n) => `${n} tool call${n > 1 ? "s" : ""}`,
  dynamic_tool_call: (n) => `${n} action${n > 1 ? "s" : ""}`,
};

interface ToolGroupProps {
  items: TimelineItem[];
  categories: Record<string, number>;
}

export function ToolGroup({ items, categories }: ToolGroupProps) {
  const isStreaming = items.some(
    (i) => i.kind === "work_item" && !i.completed
  );
  const [expanded, setExpanded] = useState(isStreaming);

  const totalCount = Object.values(categories).reduce((a, b) => a + b, 0);

  return (
    <div className="ml-10 border rounded-lg bg-muted/5 border-border/20 overflow-hidden">
      <button
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-muted/10 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 text-muted-foreground/30 transition-transform shrink-0",
            expanded && "rotate-90"
          )}
        />

        {/* Category badges */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {Object.entries(categories).map(([cat, count]) => {
            const Icon = categoryIcons[cat] ?? Wrench;
            const color = categoryColors[cat] ?? "text-muted-foreground/50";
            const label = categoryLabels[cat]?.(count) ?? `${count} ${cat}`;
            return (
              <span
                key={cat}
                className="flex items-center gap-1 text-xs text-muted-foreground/60"
              >
                <Icon className={cn("h-3 w-3 shrink-0", color)} />
                <span className="font-mono">{label}</span>
              </span>
            );
          })}
        </div>

        {/* Total count + spinner */}
        <span className="text-[10px] font-mono text-muted-foreground/40 shrink-0">
          {totalCount}
        </span>
        {isStreaming && (
          <Loader2 className="h-3 w-3 text-blue-500 animate-spin shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border/10 space-y-1 py-1.5">
          {items.map((item) => {
            if (item.kind === "work_item") {
              return (
                <div key={item.id} className="px-1.5">
                  <WorkItem
                    toolName={item.toolName ?? "unknown"}
                    toolCategory={item.toolCategory ?? "dynamic_tool_call"}
                    input={item.input ?? {}}
                    output={item.output}
                    error={item.error}
                    completed={item.completed ?? true}
                    nested
                  />
                </div>
              );
            }
            if (item.kind === "error") {
              return (
                <div key={item.id} className="px-3 py-1">
                  <div className="text-[11px] text-red-400 bg-red-500/5 border border-red-500/20 rounded px-2 py-1 font-mono">
                    {item.content}
                  </div>
                </div>
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}
