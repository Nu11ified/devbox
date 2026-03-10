"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useThreadSocket, type ThreadEvent } from "@/hooks/use-thread-socket";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { Timeline, type TimelineItem } from "@/components/thread/timeline";
import { Composer } from "@/components/thread/composer";
import { DiffPanel } from "@/components/thread/diff-panel";
import { TerminalDrawer, type TerminalDrawerHandle } from "@/components/thread/terminal-drawer";
import { Loader2, Trash2, Square, GitCompareArrows, TerminalIcon, GitPullRequest, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { ErrorBoundary } from "@/components/error-boundary";

export default function ThreadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [thread, setThread] = useState<any>(null);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showDiff, setShowDiff] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [diffFiles, setDiffFiles] = useState<
    Array<{
      path: string;
      status: "added" | "modified" | "deleted";
      hunks: Array<{
        header: string;
        lines: Array<{ type: "add" | "remove" | "context"; content: string }>;
      }>;
    }>
  >([]);
  const [terminalSessionId, setTerminalSessionId] = useState<string | null>(null);
  const terminalDrawerRef = useRef<TerminalDrawerHandle>(null);
  const assistantTextRef = useRef<string>("");
  const assistantItemIdRef = useRef<string | null>(null);

  /** Load thread data from API and rebuild timeline items. */
  const loadThread = useCallback(async () => {
    if (!id) return;
    try {
      const data: any = await api.getThread(id);
      setThread(data);
      const initial: TimelineItem[] = [];

      // Build a map of events by turnId for interleaving
      const eventsByTurn = new Map<string, any[]>();
      for (const evt of data.events ?? []) {
        const tid = evt.turnId ?? evt.payload?.turnId ?? "__none__";
        if (!eventsByTurn.has(tid)) eventsByTurn.set(tid, []);
        eventsByTurn.get(tid)!.push(evt);
      }

      // Track completed item IDs for marking work_items
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

      for (const turn of data.turns ?? []) {
        // Insert tool use events that belong to this turn BEFORE the turn text
        const turnEvents = eventsByTurn.get(turn.turnId ?? turn.id) ?? [];
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
              resolved: true, // Historical requests are resolved
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
      const lastTurn = (data.turns ?? []).findLast((t: any) => t.role === "assistant");
      setRunning(lastTurn?.status === "running");
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Load on mount
  useEffect(() => { loadThread(); }, [loadThread]);

  const handleEvent = useCallback((event: ThreadEvent) => {
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

        case "diff.updated": {
          setDiffFiles(e.payload.files ?? []);
          setShowDiff(true);
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
      if (event.status !== "active") {
        setRunning(false);
      }
    }

    if (event.type === "thread.terminal.started") {
      setTerminalSessionId(event.sessionId ?? null);
    }

    if (event.type === "thread.terminal.output") {
      // Write directly to xterm via ref — bypasses React state for performance
      terminalDrawerRef.current?.write(event.data ?? "");
    }

    if (event.type === "thread.terminal.exited") {
      setTerminalSessionId(null);
    }

    if (event.type === "thread.error") {
      setItems((prev) => [
        ...prev,
        { id: `error-${Date.now()}`, kind: "error", content: event.error ?? "Unknown error" },
      ]);
      setRunning(false);
    }
  }, []);

  const { connected, sendTurn, interrupt, approve, stop, send } = useThreadSocket({
    threadId: id,
    onEvent: handleEvent,
    onReconnect: loadThread,
  });

  const shortcuts = useMemo(
    () => [
      { key: "d", meta: true, handler: () => setShowDiff((v) => !v), description: "Toggle diff panel" },
      { key: "t", meta: true, handler: () => setShowTerminal((v) => !v), description: "Toggle terminal" },
      { key: "Escape", handler: () => { setShowDiff(false); setShowTerminal(false); }, description: "Close panels" },
    ],
    []
  );
  useKeyboardShortcuts(shortcuts);

  useEffect(() => {
    const onToggleDiff = () => setShowDiff((v) => !v);
    const onToggleTerminal = () => setShowTerminal((v) => !v);
    const onClosePanels = () => { setShowDiff(false); setShowTerminal(false); };
    window.addEventListener("toggle-diff", onToggleDiff);
    window.addEventListener("toggle-terminal", onToggleTerminal);
    window.addEventListener("close-panels", onClosePanels);
    return () => {
      window.removeEventListener("toggle-diff", onToggleDiff);
      window.removeEventListener("toggle-terminal", onToggleTerminal);
      window.removeEventListener("close-panels", onClosePanels);
    };
  }, []);

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

  async function handleForceStop() {
    if (!id) return;
    try {
      await api.stopThread(id);
      setRunning(false);
    } catch (err) {
      console.error("Failed to stop:", err);
    }
  }

  const [creatingPR, setCreatingPR] = useState(false);
  const [prUrl, setPrUrl] = useState<string | null>(null);

  async function handleCreatePR() {
    if (!id) return;
    setCreatingPR(true);
    try {
      const result = await api.createPR(id);
      setPrUrl(result.prUrl);
      window.open(result.prUrl, "_blank");
    } catch (err: any) {
      console.error("Failed to create PR:", err);
    } finally {
      setCreatingPR(false);
    }
  }

  async function handleDelete() {
    if (!id || !confirm("Delete this thread?")) return;
    try {
      await api.stopThread(id).catch(() => {});
      await api.deleteThread(id);
      router.push("/threads");
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/30" />
      </div>
    );
  }

  return (
    <ErrorBoundary>
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border/20 px-4 py-2 flex items-center justify-between bg-background/50 backdrop-blur-sm">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-sm font-medium truncate max-w-md text-foreground/90">
            {thread?.title ?? "Thread"}
          </h1>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-muted-foreground/50 px-1.5 py-0.5 rounded bg-muted/30">
              {thread?.provider}
            </span>
            {thread?.model && (
              <span className="text-[10px] font-mono text-muted-foreground/30">
                {thread.model}
              </span>
            )}
          </div>
          {running && (
            <div className="flex items-center gap-1.5">
              <Zap className="h-3 w-3 text-amber-500" />
              <span className="text-[10px] font-mono text-amber-500/70">Working</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowDiff((v) => !v)}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono transition-colors",
              showDiff ? "text-primary bg-primary/10" : "text-muted-foreground/40 hover:text-foreground/70 hover:bg-muted/30"
            )}
            title="Toggle diff panel (Cmd+D)"
          >
            <GitCompareArrows className="h-3 w-3" />
            Diff
          </button>
          <button
            onClick={() => setShowTerminal((v) => !v)}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono transition-colors",
              showTerminal ? "text-primary bg-primary/10" : "text-muted-foreground/40 hover:text-foreground/70 hover:bg-muted/30"
            )}
            title="Toggle terminal (Cmd+T)"
          >
            <TerminalIcon className="h-3 w-3" />
            Terminal
          </button>
          {thread?.repo && (
            <button
              onClick={handleCreatePR}
              disabled={creatingPR || !!prUrl}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono text-green-500/70 hover:bg-green-500/10 transition-colors disabled:opacity-40"
              title="Create pull request"
            >
              {creatingPR ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <GitPullRequest className="h-3 w-3" />
              )}
              {prUrl ? "PR Created" : "Create PR"}
            </button>
          )}
          {running && (
            <button
              onClick={handleForceStop}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono text-amber-500/70 hover:bg-amber-500/10 transition-colors"
              title="Force stop session"
            >
              <Square className="h-3 w-3" />
              Stop
            </button>
          )}
          <div className="w-px h-4 bg-border/20 mx-1" />
          <button
            onClick={handleDelete}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono text-muted-foreground/30 hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="Delete thread"
          >
            <Trash2 className="h-3 w-3" />
          </button>
          <div className="w-px h-4 bg-border/20 mx-1" />
          <div className="flex items-center gap-1.5">
            <span className={cn(
              "w-1.5 h-1.5 rounded-full",
              connected ? "bg-green-500" : "bg-amber-500 animate-pulse"
            )} />
            <span className="text-[10px] text-muted-foreground/40">
              {connected ? "Connected" : "Reconnecting..."}
            </span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        <div className="flex flex-col flex-1 min-w-0">
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

        <DiffPanel
          files={diffFiles}
          open={showDiff}
          onClose={() => setShowDiff(false)}
        />
      </div>

      <TerminalDrawer
        ref={terminalDrawerRef}
        sendTerminal={send}
        connected={connected}
        open={showTerminal}
        onToggle={() => setShowTerminal((v) => !v)}
        sessionId={terminalSessionId}
      />
    </div>
    </ErrorBoundary>
  );
}
