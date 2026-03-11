"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useThreadSocket, type ThreadEvent } from "@/hooks/use-thread-socket";
import { Timeline, type TimelineItem } from "@/components/thread/timeline";
import { Composer } from "@/components/thread/composer";
import { cn } from "@/lib/utils";

export interface TeamPaneProps {
  threadId: string;
  agentName: string;
  role: "lead" | "teammate";
  focused: boolean;
  onFocus: () => void;
  onTeamMessage?: (msg: {
    fromName: string;
    content: string;
    toThreadId?: string;
  }) => void;
}

export function TeamPane({
  threadId,
  agentName,
  role,
  focused,
  onFocus,
  onTeamMessage,
}: TeamPaneProps) {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [running, setRunning] = useState(false);
  const [thread, setThread] = useState<any>(null);

  // Refs for accumulating streaming assistant text
  const assistantTextRef = useRef<string>("");
  const assistantItemIdRef = useRef<string | null>(null);

  // Load thread data on mount
  useEffect(() => {
    if (!threadId) return;
    api
      .getThread(threadId)
      .then((data: any) => {
        setThread(data);
        const initial: TimelineItem[] = [];

        // Build a map of completed items
        const completedItems = new Set<string>();
        const completedPayloads = new Map<string, any>();
        for (const evt of data.events ?? []) {
          if (evt.type === "item.completed") {
            const itemId = evt.payload?.itemId;
            if (itemId) {
              completedItems.add(itemId);
              completedPayloads.set(itemId, evt.payload);
            }
          }
        }

        // Build events-by-turn map for interleaving
        const eventsByTurn = new Map<string, any[]>();
        for (const evt of data.events ?? []) {
          const tid = evt.turnId ?? evt.payload?.turnId ?? "__none__";
          if (!eventsByTurn.has(tid)) eventsByTurn.set(tid, []);
          eventsByTurn.get(tid)!.push(evt);
        }

        for (const turn of data.turns ?? []) {
          const turnEvents =
            eventsByTurn.get(turn.turnId ?? turn.id) ?? [];
          for (const evt of turnEvents) {
            if (evt.type === "item.started") {
              const p = evt.payload;
              const completed = completedItems.has(p.itemId);
              const cp = completedPayloads.get(p.itemId);
              initial.push({
                id: p.itemId,
                kind: "work_item",
                toolName: p.toolName,
                toolCategory: p.toolCategory,
                input: p.input,
                completed,
                output: cp?.output,
                error: cp?.error,
              });
            } else if (evt.type === "request.opened") {
              const p = evt.payload;
              initial.push({
                id: `req-${p.requestId}`,
                kind: "approval_request",
                requestId: p.requestId,
                toolName: p.toolName,
                toolCategory: p.toolCategory,
                description: p.description,
                input: p.input,
                resolved: true,
              });
            }
          }
          initial.push({
            id: turn.id,
            kind: turn.role === "user" ? "user_message" : "assistant_text",
            content: turn.content ?? "",
          });
        }

        setItems(initial);
        const lastTurn = (data.turns ?? []).findLast(
          (t: any) => t.role === "assistant"
        );
        setRunning(lastTurn?.status === "running");
      })
      .catch(console.error);
  }, [threadId]);

  const handleEvent = useCallback(
    (event: ThreadEvent) => {
      if (event.type === "thread.turn.started") {
        assistantTextRef.current = "";
        assistantItemIdRef.current = null;
      }

      if (event.type === "thread.event" && event.event) {
        const e = event.event;

        switch (e.type) {
          case "turn.started": {
            assistantTextRef.current = "";
            assistantItemIdRef.current = null;
            break;
          }

          case "content.delta": {
            if (e.payload.kind === "text") {
              assistantTextRef.current += e.payload.delta;
              const itemId =
                assistantItemIdRef.current ?? `text-${Date.now()}`;
              if (!assistantItemIdRef.current) {
                assistantItemIdRef.current = itemId;
              }
              setItems((prev) => {
                const existing = prev.findIndex((i) => i.id === itemId);
                const updated: TimelineItem = {
                  id: itemId,
                  kind: "assistant_text",
                  content: assistantTextRef.current,
                  streaming: true,
                };
                if (existing >= 0) {
                  const next = [...prev];
                  next[existing] = updated;
                  return next;
                }
                return [...prev, updated];
              });
            }
            break;
          }

          case "turn.completed": {
            if (assistantItemIdRef.current) {
              setItems((prev) =>
                prev.map((i) =>
                  i.id === assistantItemIdRef.current
                    ? { ...i, streaming: false }
                    : i
                )
              );
            }
            assistantTextRef.current = "";
            assistantItemIdRef.current = null;
            setRunning(false);
            break;
          }

          case "item.started": {
            setItems((prev) => [
              ...prev,
              {
                id: e.payload.itemId,
                kind: "work_item",
                toolName: e.payload.toolName,
                toolCategory: e.payload.toolCategory,
                input: e.payload.input,
                completed: false,
              },
            ]);
            break;
          }

          case "item.completed": {
            setItems((prev) =>
              prev.map((i) =>
                i.id === e.payload.itemId
                  ? {
                      ...i,
                      completed: true,
                      output: e.payload.output,
                      error: e.payload.error,
                    }
                  : i
              )
            );
            break;
          }

          case "request.opened": {
            setItems((prev) => [
              ...prev,
              {
                id: `req-${e.payload.requestId}`,
                kind: "approval_request",
                requestId: e.payload.requestId,
                toolName: e.payload.toolName,
                toolCategory: e.payload.toolCategory,
                description: e.payload.description,
                input: e.payload.input,
                resolved: false,
              },
            ]);
            break;
          }

          case "request.resolved": {
            setItems((prev) =>
              prev.map((i) =>
                i.requestId === e.payload.requestId
                  ? { ...i, resolved: true, decision: e.payload.decision }
                  : i
              )
            );
            break;
          }

          case "session.exited": {
            setRunning(false);
            break;
          }

          case "runtime.error": {
            setItems((prev) => [
              ...prev,
              {
                id: `error-${Date.now()}`,
                kind: "error",
                content: e.payload.message,
              },
            ]);
            break;
          }

          case "runtime.warning": {
            setItems((prev) => [
              ...prev,
              {
                id: `warn-${Date.now()}`,
                kind: "error",
                content: `Warning: ${e.payload.message}`,
              },
            ]);
            break;
          }
        }
      }

      // team.message.received — surface as assistant text item and notify parent
      if (event.type === "team.message.received") {
        const content =
          (event as any).content ?? (event as any).message ?? "";
        const fromName = (event as any).fromName ?? "teammate";
        const msgId = `team-msg-${Date.now()}`;
        setItems((prev) => [
          ...prev,
          { id: msgId, kind: "assistant_text", content: `[${fromName}]: ${content}` },
        ]);
        onTeamMessage?.({
          fromName,
          content,
          toThreadId: threadId,
        });
      }

      if (event.type === "thread.session.status") {
        if (event.status !== "active") {
          setRunning(false);
        }
      }

      if (event.type === "thread.error") {
        setItems((prev) => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            kind: "error",
            content: (event as any).error ?? "Unknown error",
          },
        ]);
        setRunning(false);
      }
    },
    [threadId, onTeamMessage]
  );

  const { connected, sendTurn, interrupt, approve, stop } = useThreadSocket({
    threadId,
    onEvent: handleEvent,
    onReconnect: () => {
      // Re-fetch thread state on reconnect
      api
        .getThread(threadId)
        .then((data: any) => {
          setThread(data);
        })
        .catch(console.error);
    },
  });

  const handleSend = useCallback(
    (text: string, model?: string, effort?: string) => {
      setItems((prev) => [
        ...prev,
        { id: `user-${Date.now()}`, kind: "user_message", content: text },
      ]);
      setRunning(true);
      sendTurn(text, model, effort);
    },
    [sendTurn]
  );

  // Status dot: green pulsing when running, red when disconnected, gray idle
  const statusDotClass = running
    ? "bg-green-500 animate-pulse"
    : !connected
    ? "bg-red-500"
    : "bg-zinc-500";

  return (
    <div
      className={cn(
        "flex flex-col h-full rounded-lg border transition-colors cursor-pointer overflow-hidden",
        focused
          ? "border-violet-500/50 shadow-sm shadow-violet-500/10"
          : "border-zinc-800/60 hover:border-zinc-700/60"
      )}
      onClick={onFocus}
    >
      {/* Header */}
      <div
        className={cn(
          "flex items-center justify-between px-3 py-2 shrink-0 border-b",
          focused ? "border-violet-500/20 bg-violet-500/5" : "border-zinc-800/40 bg-zinc-900/50"
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn("w-2 h-2 rounded-full shrink-0", statusDotClass)}
            title={
              running
                ? "Running"
                : !connected
                ? "Disconnected"
                : "Idle"
            }
          />
          <span className="text-sm font-medium text-zinc-100 truncate">
            {agentName}
          </span>
        </div>
        <span
          className={cn(
            "text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0",
            role === "lead"
              ? "bg-violet-500/20 text-violet-400"
              : "bg-zinc-700/50 text-zinc-400"
          )}
        >
          {role}
        </span>
      </div>

      {/* Timeline */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <Timeline items={items} onApprove={approve} />
      </div>

      {/* Composer */}
      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <Composer
          onSend={handleSend}
          onInterrupt={interrupt}
          onStop={stop}
          running={running}
          connected={connected}
          provider={thread?.provider}
          model={thread?.model}
        />
      </div>
    </div>
  );
}
