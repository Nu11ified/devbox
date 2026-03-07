"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { useThreadSocket, type ThreadEvent } from "@/hooks/use-thread-socket";
import { Timeline, type TimelineItem } from "@/components/thread/timeline";
import { Composer } from "@/components/thread/composer";
import { Loader2 } from "lucide-react";

export default function ThreadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [thread, setThread] = useState<any>(null);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const assistantTextRef = useRef<string>("");
  const assistantItemIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.getThread(id)
      .then((data: any) => {
        setThread(data);
        const initial: TimelineItem[] = [];
        for (const turn of data.turns ?? []) {
          initial.push({
            id: turn.id,
            kind: turn.role === "user" ? "user_message" : "assistant_text",
            content: turn.content ?? "",
          });
        }
        setItems(initial);
        setRunning(data.status === "active");
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const handleEvent = useCallback((event: ThreadEvent) => {
    if (event.type === "thread.turn.started") {
      assistantTextRef.current = "";
      assistantItemIdRef.current = null;
    }

    if (event.type === "thread.event" && event.event) {
      const e = event.event;

      switch (e.type) {
        case "turn.started": {
          // New turn starting — reset streaming state
          assistantTextRef.current = "";
          assistantItemIdRef.current = null;
          break;
        }

        case "content.delta": {
          if (e.payload.kind === "text") {
            assistantTextRef.current += e.payload.delta;
            const itemId = assistantItemIdRef.current ?? `text-${Date.now()}`;
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
                i.id === assistantItemIdRef.current ? { ...i, streaming: false } : i
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
                ? { ...i, completed: true, output: e.payload.output, error: e.payload.error }
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

        case "runtime.error": {
          setItems((prev) => [
            ...prev,
            { id: `error-${Date.now()}`, kind: "error", content: e.payload.message },
          ]);
          break;
        }

        case "session.exited": {
          setRunning(false);
          break;
        }
      }
    }

    if (event.type === "thread.session.status") {
      setRunning(event.status === "active");
    }
  }, []);

  const { connected, sendTurn, interrupt, approve, stop } = useThreadSocket({
    threadId: id,
    onEvent: handleEvent,
  });

  const handleSend = useCallback(
    (text: string, model?: string) => {
      setItems((prev) => [
        ...prev,
        { id: `user-${Date.now()}`, kind: "user_message" as const, content: text },
      ]);
      setRunning(true);
      sendTurn(text, model);
    },
    [sendTurn]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <div className="border-b border-border/40 px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-medium truncate max-w-md">
            {thread?.title ?? "Thread"}
          </h1>
          <span className="text-[10px] font-mono text-muted-foreground/60 px-1.5 py-0.5 rounded bg-muted">
            {thread?.provider}
          </span>
          {thread?.model && (
            <span className="text-[10px] font-mono text-muted-foreground/40">
              {thread.model}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-amber-500 animate-pulse"}`} />
          <span className="text-[10px] text-muted-foreground/60">
            {connected ? "Connected" : "Reconnecting..."}
          </span>
        </div>
      </div>

      <Timeline items={items} onApprove={approve} />

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
  );
}
