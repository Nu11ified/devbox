"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { api } from "@/lib/api";

export interface ThreadEvent {
  type: string;
  event?: any;
  threadId?: string;
  status?: string;
  error?: string;
  turnId?: string;
  /** Terminal events */
  sessionId?: string;
  data?: string;
  exitCode?: number;
}

interface UseThreadSocketOptions {
  threadId: string | null;
  onEvent?: (event: ThreadEvent) => void;
  /** Called when the WS reconnects after a drop — UI should re-fetch state */
  onReconnect?: () => void;
}

/**
 * Resolve WebSocket URL.
 * Falls back to same origin (routed to server via Traefik PathPrefix /ws).
 */
function getWsUrl(threadId: string, ticket?: string): string {
  const params = new URLSearchParams({ threadId });
  if (ticket) params.set("ticket", ticket);

  const wsUrl = process.env.NEXT_PUBLIC_WS_URL;
  if (wsUrl) {
    // Direct connection to server (cross-origin or explicit override)
    return `${wsUrl}/ws/threads?${params}`;
  }
  // Same-origin: route through Next.js rewrite (/api/ws/* → server /ws/*)
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/ws/threads?${params}`;
}

/** True when WS URL points to a different origin (cross-origin needs a ticket). */
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

export function useThreadSocket({ threadId, onEvent, onReconnect }: UseThreadSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onReconnectRef = useRef(onReconnect);
  onReconnectRef.current = onReconnect;
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempt = useRef(0);
  const hasConnectedOnce = useRef(false);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Only connect for valid UUID thread IDs (skip "new" or other non-UUID values)
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!threadId || !uuidRe.test(threadId)) return;

    let disposed = false;

    async function connect() {
      if (disposed) return;

      // For cross-origin WS, get a short-lived ticket from the server
      let ticket: string | undefined;
      if (isCrossOriginWs()) {
        try {
          ticket = await api.getWsTicket();
        } catch {
          // Retry with backoff if ticket fetch fails
          if (!disposed) {
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempt.current), 30000);
            reconnectAttempt.current++;
            reconnectTimer.current = setTimeout(connect, delay);
          }
          return;
        }
        if (disposed) return;
      }

      const wsUrl = getWsUrl(threadId!, ticket);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        const wasReconnect = hasConnectedOnce.current;
        hasConnectedOnce.current = true;
        reconnectAttempt.current = 0;

        // Start client-side ping every 20s (for proxies that don't forward WS pings)
        if (pingTimer.current) clearInterval(pingTimer.current);
        pingTimer.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, 20_000);

        // If this is a reconnect, tell the UI to re-fetch state
        if (wasReconnect) {
          onReconnectRef.current?.();
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (pingTimer.current) {
          clearInterval(pingTimer.current);
          pingTimer.current = null;
        }
        // Auto-reconnect with exponential backoff (1s, 2s, 4s, 8s, ... max 30s)
        if (!disposed) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempt.current), 30000);
          reconnectAttempt.current++;
          reconnectTimer.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        // onclose will fire after onerror
      };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          // Ignore pong responses
          if (data.type === "pong") return;
          onEventRef.current?.(data);
        } catch {
          // Ignore non-JSON
        }
      };
    }

    void connect();

    return () => {
      disposed = true;
      reconnectAttempt.current = 0;
      hasConnectedOnce.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (pingTimer.current) clearInterval(pingTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [threadId]);

  const send = useCallback(
    (message: Record<string, unknown>) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(message));
      }
    },
    []
  );

  // sendTurn with HTTP fallback when WS is disconnected
  const sendTurn = useCallback(
    (text: string, model?: string, effort?: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        send({ type: "thread.sendTurn", text, model, effort });
      } else if (threadId) {
        // Fallback: send via HTTP API
        api.sendTurn(threadId, text, model, effort).catch(console.error);
      }
    },
    [send, threadId]
  );

  const interrupt = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      send({ type: "thread.interrupt" });
    } else if (threadId) {
      api.interruptThread(threadId).catch(console.error);
    }
  }, [send, threadId]);

  const approve = useCallback(
    (requestId: string, decision: "allow" | "deny" | "allow_session") => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        send({ type: "thread.approval", requestId, decision });
      } else if (threadId) {
        api.approveRequest(threadId, requestId, decision).catch(console.error);
      }
    },
    [send, threadId]
  );

  const stop = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      send({ type: "thread.stop" });
    } else if (threadId) {
      api.stopThread(threadId).catch(console.error);
    }
  }, [send, threadId]);

  return { connected, sendTurn, interrupt, approve, stop, send };
}
