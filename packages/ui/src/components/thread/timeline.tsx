"use client";

import { useRef, useEffect } from "react";
import { MessageBubble } from "./message-bubble";
import { ApprovalCard } from "./approval-card";
import { WorkItem } from "./work-item";

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

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
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
              <div key={item.id} className="text-sm text-red-500 bg-red-500/5 border border-red-500/20 rounded-md px-3 py-2 font-mono">
                {item.content}
              </div>
            );
          default:
            return null;
        }
      })}
      <div ref={bottomRef} />
    </div>
  );
}
