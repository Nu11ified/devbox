"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TranscriptEvent } from "@/lib/api";
import { connectRunStream } from "@/lib/ws";

interface UseRunStreamResult {
  events: TranscriptEvent[];
  isConnected: boolean;
  error: string | null;
}

export function useRunStream(runId: string | null): UseRunStreamResult {
  const [events, setEvents] = useState<TranscriptEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (!runId) return;

    setError(null);

    const cleanup = connectRunStream(runId, (event) => {
      setIsConnected(true);
      setEvents((prev) => [...prev, event]);
    });

    cleanupRef.current = cleanup;
  }, [runId]);

  useEffect(() => {
    if (!runId) return;

    connect();

    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [runId, connect]);

  return { events, isConnected, error };
}
