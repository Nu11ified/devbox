"use client";

import { useRef, useEffect } from "react";
import { ChevronUp, ChevronDown, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";

interface TerminalLine {
  id: string;
  content: string;
  timestamp: number;
}

interface TerminalDrawerProps {
  lines: TerminalLine[];
  open: boolean;
  onToggle: () => void;
}

export function TerminalDrawer({ lines, open, onToggle }: TerminalDrawerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines.length, open]);

  return (
    <div
      className={cn(
        "border-t border-border/40 bg-black/90 transition-all duration-200",
        open ? "h-64" : "h-8"
      )}
    >
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full px-3 h-8 text-xs text-green-400/70 hover:text-green-400"
      >
        <Terminal className="h-3 w-3" />
        <span className="font-mono">Terminal Output</span>
        <span className="ml-auto">
          {open ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronUp className="h-3 w-3" />
          )}
        </span>
      </button>

      {open && (
        <div
          ref={scrollRef}
          className="h-[calc(100%-2rem)] overflow-y-auto px-3 pb-2 font-mono text-xs text-green-400/90"
        >
          {lines.map((line) => (
            <div key={line.id} className="whitespace-pre-wrap break-all leading-relaxed">
              {line.content}
            </div>
          ))}
          {lines.length === 0 && (
            <div className="text-green-400/30 py-4 text-center">
              No terminal output yet
            </div>
          )}
        </div>
      )}
    </div>
  );
}
