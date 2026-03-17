"use client";

import { useRef, useEffect } from "react";
import { MessageBubble } from "./message-bubble";
import { ApprovalCard } from "./approval-card";
import { AskUserCard } from "./ask-user-card";
import { WorkItem } from "./work-item";
import { Bot, CheckCircle2, Circle, Loader2 } from "lucide-react";

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface TimelineItem {
  id: string;
  kind: "user_message" | "assistant_text" | "work_item" | "approval_request" | "error" | "todo_progress" | "ask_user";
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
  /** Todo tracking */
  todos?: TodoItem[];
  /** AskUserQuestion */
  question?: string;
  options?: Array<{ label: string; value: string }>;
}

interface TimelineProps {
  items: TimelineItem[];
  onApprove: (requestId: string, decision: "allow" | "deny" | "allow_session") => void;
  onRespondToAsk?: (requestId: string, answer: string) => void;
}

export function Timeline({ items, onApprove, onRespondToAsk }: TimelineProps) {
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
            case "todo_progress":
              return (
                <div key={item.id} className="flex gap-3 items-start max-w-3xl mx-auto">
                  <div className="w-7 h-7 rounded-full bg-violet-500/10 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="h-3.5 w-3.5 text-violet-500/60" />
                  </div>
                  <div className="bg-violet-500/5 border border-violet-500/20 rounded-lg px-3 py-2 flex-1">
                    <div className="text-[10px] font-mono text-violet-400/70 mb-1.5">Progress</div>
                    <div className="space-y-1">
                      {(item.todos ?? []).map((todo) => (
                        <div key={todo.id} className="flex items-center gap-2 text-xs">
                          {todo.status === "completed" ? (
                            <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                          ) : todo.status === "in_progress" ? (
                            <Loader2 className="h-3 w-3 text-amber-500 animate-spin shrink-0" />
                          ) : (
                            <Circle className="h-3 w-3 text-zinc-600 shrink-0" />
                          )}
                          <span className={
                            todo.status === "completed"
                              ? "text-zinc-400 line-through"
                              : todo.status === "in_progress"
                              ? "text-amber-400"
                              : "text-zinc-500"
                          }>
                            {todo.content}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            case "ask_user":
              return (
                <AskUserCard
                  key={item.id}
                  requestId={item.requestId ?? ""}
                  question={item.question ?? ""}
                  options={item.options}
                  resolved={item.resolved}
                  response={item.decision}
                  onRespond={onRespondToAsk ?? (() => {})}
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
