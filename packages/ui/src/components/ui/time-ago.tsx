"use client";

import { useEffect, useState } from "react";

function formatTimeAgo(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (weeks < 5) return `${weeks}w ago`;
  if (months < 12) return `${months}mo ago`;
  return `${years}y ago`;
}

export function TimeAgo({ date }: { date: string | Date }) {
  const d = typeof date === "string" ? new Date(date) : date;
  const [text, setText] = useState(() => formatTimeAgo(d));

  useEffect(() => {
    setText(formatTimeAgo(d));
    const interval = setInterval(() => setText(formatTimeAgo(d)), 60_000);
    return () => clearInterval(interval);
  }, [d.getTime()]);

  return (
    <time
      dateTime={d.toISOString()}
      title={d.toLocaleString()}
      suppressHydrationWarning
      className="text-[10px] font-mono text-muted-foreground/60"
    >
      {text}
    </time>
  );
}
