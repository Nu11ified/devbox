"use client";

import { useState } from "react";
import {
  MessageSquare,
  Wrench,
  CheckCircle2,
  XCircle,
  Terminal,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TranscriptEvent } from "@/lib/api";

const typeConfig: Record<
  string,
  { icon: typeof MessageSquare; label: string; color: string }
> = {
  message: { icon: MessageSquare, label: "Message", color: "text-blue-500" },
  agent_message: { icon: MessageSquare, label: "Message", color: "text-blue-500" },
  tool_call: { icon: Wrench, label: "Tool Call", color: "text-amber-500" },
  tool_result: { icon: CheckCircle2, label: "Result", color: "text-green-500" },
  error: { icon: XCircle, label: "Error", color: "text-red-500" },
  raw_pty: { icon: Terminal, label: "Terminal", color: "text-gray-500" },
  done_marker: { icon: CheckCircle2, label: "Done", color: "text-green-500" },
  budget_exceeded: { icon: XCircle, label: "Budget", color: "text-red-500" },
  blueprint_transition: { icon: ChevronRight, label: "Step", color: "text-purple-500" },
  patch_created: { icon: CheckCircle2, label: "Patch", color: "text-green-500" },
};

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

function parseContent(content: string): { text: string; data?: Record<string, unknown> } {
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed === "object" && parsed !== null) {
      return { text: parsed.content || parsed.message || parsed.tool || JSON.stringify(parsed, null, 2), data: parsed };
    }
    return { text: String(content) };
  } catch {
    return { text: String(content) };
  }
}

export function TranscriptEventRow({ event }: { event: TranscriptEvent }) {
  const [expanded, setExpanded] = useState(false);
  const config = typeConfig[event.type] ?? typeConfig.message;
  const Icon = config.icon;
  const isExpandable = event.type === "tool_call" || event.type === "tool_result";
  const { text, data } = parseContent(event.content);

  return (
    <div className="group flex gap-3 px-3 py-2 hover:bg-accent/30 rounded-md">
      <div className="flex flex-col items-center gap-1 pt-0.5">
        <Icon className={cn("h-4 w-4 shrink-0", config.color)} />
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {config.label}
          </span>
          <span className="text-xs text-muted-foreground/60">
            {formatTime(event.timestamp)}
          </span>
          {isExpandable && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="ml-auto text-muted-foreground hover:text-foreground"
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>
          )}
        </div>
        {isExpandable && !expanded ? (
          <p className="text-sm text-foreground/80 truncate">
            {data?.tool ? String(data.tool) : text.slice(0, 100)}
          </p>
        ) : (
          <div className="text-sm text-foreground/80 whitespace-pre-wrap break-words prose prose-sm dark:prose-invert max-w-none">
            {text}
          </div>
        )}
      </div>
    </div>
  );
}
