import type { TranscriptEvent } from "./api";

const WS_BASE =
  process.env.NEXT_PUBLIC_WS_URL ||
  (typeof window !== "undefined"
    ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`
    : "ws://localhost:3001");

export function connectRunStream(
  runId: string,
  onEvent: (event: TranscriptEvent) => void,
): () => void {
  const ws = new WebSocket(`${WS_BASE}/api/runs/${runId}/stream`);

  ws.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data as string) as TranscriptEvent;
      onEvent(event);
    } catch {
      // ignore malformed messages
    }
  };

  return () => {
    ws.close();
  };
}
