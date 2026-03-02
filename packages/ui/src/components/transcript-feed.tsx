"use client";

import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TranscriptEventRow } from "@/components/transcript-event";
import type { TranscriptEvent } from "@/lib/api";

export function TranscriptFeed({
  events,
  isConnected,
}: {
  events: TranscriptEvent[];
  isConnected: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-0.5 p-2">
        {events.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {isConnected
              ? "Waiting for events..."
              : "Connecting to stream..."}
          </div>
        )}
        {events.map((event) => (
          <TranscriptEventRow key={event.id} event={event} />
        ))}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
