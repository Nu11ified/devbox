"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";

interface PendingInput {
  threadId: string;
  requestId: string;
  question: string;
  options?: Array<{ label: string; value: string }>;
  threadName?: string;
}

interface PendingInputsContextValue {
  pendingInputs: Map<string, PendingInput>;
}

const PendingInputsContext = createContext<PendingInputsContextValue>({
  pendingInputs: new Map(),
});

export function usePendingInputs() {
  return useContext(PendingInputsContext);
}

function getProjectWsUrl(projectId: string, ticket?: string): string {
  const params = new URLSearchParams();
  if (ticket) params.set("ticket", ticket);
  const qs = params.toString();

  const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
  if (wsUrl) {
    return `${wsUrl}/ws/projects/${projectId}/events${qs ? `?${qs}` : ""}`;
  }
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/ws/projects/${projectId}/events${qs ? `?${qs}` : ""}`;
}

function isCrossOriginWs(): boolean {
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
  if (!wsUrl) return false;
  try {
    const wsOrigin = new URL(wsUrl.replace(/^ws/, "http")).origin;
    return wsOrigin !== window.location.origin;
  } catch {
    return false;
  }
}

export function PendingInputsProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const [pendingInputs, setPendingInputs] = useState<Map<string, PendingInput>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempt = useRef(0);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    let disposed = false;

    async function connect() {
      if (disposed) return;

      let ticket: string | undefined;
      if (isCrossOriginWs()) {
        try {
          ticket = await api.getWsTicket();
        } catch {
          if (!disposed) {
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempt.current), 30000);
            reconnectAttempt.current++;
            reconnectTimer.current = setTimeout(connect, delay);
          }
          return;
        }
        if (disposed) return;
      }

      const url = getProjectWsUrl(projectId, ticket);
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempt.current = 0;
        if (pingTimer.current) clearInterval(pingTimer.current);
        pingTimer.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, 20_000);
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (pingTimer.current) {
          clearInterval(pingTimer.current);
          pingTimer.current = null;
        }
        if (!disposed) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempt.current), 30000);
          reconnectAttempt.current++;
          reconnectTimer.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {};

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === "pong") return;

          if (data.type === "thread.status") {
            if (data.status === "needs_input") {
              const input: PendingInput = {
                threadId: data.threadId,
                requestId: data.requestId,
                question: data.question ?? "Agent needs input",
                options: data.options,
                threadName: data.threadName,
              };

              setPendingInputs((prev) => {
                const next = new Map(prev);
                next.set(data.threadId, input);
                return next;
              });

              // Fire toast
              const preview = input.question.length > 60
                ? input.question.slice(0, 57) + "..."
                : input.question;
              toast({
                type: "warning",
                title: input.threadName ?? "Thread needs input",
                description: preview,
                duration: 8000,
                onClick: () => {
                  router.push(`/projects/${projectId}/threads/${data.threadId}`);
                },
              });
            } else if (data.status === "running") {
              setPendingInputs((prev) => {
                const next = new Map(prev);
                next.delete(data.threadId);
                return next;
              });
            }
          }
        } catch {}
      };
    }

    void connect();

    return () => {
      disposed = true;
      reconnectAttempt.current = 0;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (pingTimer.current) clearInterval(pingTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [projectId, router, toast]);

  return (
    <PendingInputsContext.Provider value={{ pendingInputs }}>
      {children}
    </PendingInputsContext.Provider>
  );
}
