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
}

interface UseThreadSocketOptions {
  threadId: string | null;
  onEvent?: (event: ThreadEvent) => void;
}

/**
 * Resolve WebSocket URL.
 * NEXT_PUBLIC_SERVER_URL is the backend origin (e.g. "http://server:3001").
 * Falls back to same hostname, port 3001.
 */
function getWsUrl(threadId: string): string {
  const envUrl = process.env.NEXT_PUBLIC_SERVER_URL;
  if (envUrl) {
    const url = new URL(envUrl);
    const wsProto = url.protocol === "https:" ? "wss:" : "ws:";
    return `${wsProto}//${url.host}/ws/threads?threadId=${encodeURIComponent(threadId)}`;
  }
  // Fallback: same hostname, server port (3001)
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.hostname}:3001/ws/threads?threadId=${encodeURIComponent(threadId)}`;
}

export function useThreadSocket({ threadId, onEvent }: UseThreadSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Only connect for valid UUID thread IDs (skip "new" or other non-UUID values)
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!threadId || !uuidRe.test(threadId)) return;

    let disposed = false;

    function connect() {
      if (disposed) return;

      const wsUrl = getWsUrl(threadId!);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        // Auto-reconnect after 3s
        if (!disposed) {
          reconnectTimer.current = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        // onclose will fire after onerror
      };

      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          onEventRef.current?.(data);
        } catch {
          // Ignore non-JSON
        }
      };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
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
    (text: string, model?: string) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        send({ type: "thread.sendTurn", text, model });
      } else if (threadId) {
        // Fallback: send via HTTP API
        api.sendTurn(threadId, text, model).catch(console.error);
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
