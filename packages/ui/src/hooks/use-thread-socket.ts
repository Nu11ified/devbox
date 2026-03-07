"use client";

import { useEffect, useRef, useCallback, useState } from "react";

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

export function useThreadSocket({ threadId, onEvent }: UseThreadSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!threadId) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/ws/threads?threadId=${threadId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        onEventRef.current?.(data);
      } catch {
        // Ignore non-JSON
      }
    };

    return () => {
      ws.close();
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

  const sendTurn = useCallback(
    (text: string, model?: string) => {
      send({ type: "thread.sendTurn", text, model });
    },
    [send]
  );

  const interrupt = useCallback(() => {
    send({ type: "thread.interrupt" });
  }, [send]);

  const approve = useCallback(
    (requestId: string, decision: "allow" | "deny" | "allow_session") => {
      send({ type: "thread.approval", requestId, decision });
    },
    [send]
  );

  const stop = useCallback(() => {
    send({ type: "thread.stop" });
  }, [send]);

  return { connected, sendTurn, interrupt, approve, stop, send };
}
