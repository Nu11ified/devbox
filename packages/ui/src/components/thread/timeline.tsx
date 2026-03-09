"use client";

import { useRef, useEffect } from "react";
import { MessageBubble } from "./message-bubble";
import { ApprovalCard } from "./approval-card";
import { WorkItem } from "./work-item";
import { Bot } from "lucide-react";

export interface TimelineItem {
  id: string;
  kind: "user_message" | "assistant_text" | "work_item" | "approval_request" | "error";
  content?: string;
  streaming?: boolean;
  toolName?: string;
  toolCategory?: string;
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string;
  completed?: boolean;
  requestId?: string;
  description?: string;
  resolved?: boolean;
  decision?: string;
}

interface TimelineProps {
  items: TimelineItem[];
  onApprove: (requestId: string, decision: "allow" | "deny" | "allow_session") => void;
}

export function Timeline({ items, onApprove }: TimelineProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items.length]);

  if (items.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto flex items-center justify-center">
        <div className="text-center space-y-3 max-w-sm">
          <div className="w-12 h-12 rounded-full bg-violet-500/10 flex items-center justify-center mx-auto">
            <Bot className="h-6 w-6 text-violet-500/60" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground/70">Start a conversation</p>
            <p className="text-xs text-muted-foreground/50 mt-1">
              Send a message to begin working with the agent
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {items.map((item) => {
          switch (item.kind) {
            case "user_message":
              return <MessageBubble key={item.id} role="user" content={item.content ?? ""} />;
            case "assistant_text":
              return <MessageBubble key={item.id} role="assistant" content={item.content ?? ""} streaming={item.streaming} />;
            case "work_item":
              return (
                <WorkItem
                  key={item.id}
                  toolName={item.toolName ?? "unknown"}
                  toolCategory={item.toolCategory ?? "dynamic_tool_call"}
                  input={item.input ?? {}}
                  output={item.output}
                  error={item.error}
                  completed={item.completed ?? true}
                />
              );
            case "approval_request":
              return (
                <ApprovalCard
                  key={item.id}
                  requestId={item.requestId ?? ""}
                  toolName={item.toolName ?? "unknown"}
                  toolCategory={item.toolCategory ?? "dynamic_tool_call"}
                  description={item.description}
                  input={item.input}
                  resolved={item.resolved}
                  decision={item.decision}
                  onApprove={onApprove}
                />
              );
            case "error":
              return (
                <div key={item.id} className="flex gap-3 items-start max-w-3xl mx-auto">
                  <div className="w-7 h-7 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                    <span className="text-red-500 text-xs font-bold">!</span>
                  </div>
                  <div className="text-sm text-red-400 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2 font-mono flex-1">
                    {item.content}
                  </div>
                </div>
              );
            default:
              return null;
          }
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
