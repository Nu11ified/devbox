"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { ChevronUp, ChevronDown, Terminal, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { XtermTerminal, type XtermTerminalHandle } from "./xterm-terminal";

export interface TerminalDrawerHandle {
  /** Write raw PTY output data directly into xterm (bypasses React state) */
  write: (data: string) => void;
}

interface TerminalDrawerProps {
  /** Thread WebSocket send function for terminal commands */
  sendTerminal: (message: Record<string, unknown>) => void;
  /** Whether the WS is connected */
  connected: boolean;
  /** Whether the drawer is open */
  open: boolean;
  /** Toggle visibility */
  onToggle: () => void;
  /** PTY session ID (set after thread.terminal.started) */
  sessionId: string | null;
}

import { forwardRef, useImperativeHandle } from "react";

export const TerminalDrawer = forwardRef<TerminalDrawerHandle, TerminalDrawerProps>(
  function TerminalDrawer({
    sendTerminal,
    connected,
    open,
    onToggle,
    sessionId,
  }, ref) {
  const terminalRef = useRef<XtermTerminalHandle>(null);
  const [expanded, setExpanded] = useState(false);
  const startedRef = useRef(false);

  // Expose write() to parent so PTY data flows directly to xterm
  useImperativeHandle(ref, () => ({
    write: (data: string) => {
      terminalRef.current?.write(data);
    },
  }));

  // Start PTY session when drawer opens and connected
  useEffect(() => {
    if (open && connected && !sessionId && !startedRef.current) {
      startedRef.current = true;
      sendTerminal({ type: "thread.terminal.start", cols: 120, rows: 30 });
    }
  }, [open, connected, sessionId, sendTerminal]);

  // Reset started flag when session ends
  useEffect(() => {
    if (!sessionId) {
      startedRef.current = false;
    }
  }, [sessionId]);

  const handleData = useCallback(
    (data: string) => {
      if (sessionId) {
        sendTerminal({ type: "thread.terminal.input", sessionId, data });
      }
    },
    [sessionId, sendTerminal]
  );

  const handleResize = useCallback(
    (cols: number, rows: number) => {
      if (sessionId) {
        sendTerminal({ type: "thread.terminal.resize", sessionId, cols, rows });
      }
    },
    [sessionId, sendTerminal]
  );

  return (
    <div
      className={cn(
        "border-t border-border/40 bg-[#0a0a0a] transition-all duration-200 flex flex-col",
        open
          ? expanded
            ? "h-[70vh]"
            : "h-72"
          : "h-8"
      )}
    >
      <div className="flex items-center w-full px-3 h-8 shrink-0">
        <button
          onClick={onToggle}
          className="flex items-center gap-2 text-xs text-green-400/70 hover:text-green-400"
        >
          <Terminal className="h-3 w-3" />
          <span className="font-mono">Terminal</span>
          {open ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronUp className="h-3 w-3" />
          )}
        </button>

        {open && (
          <div className="ml-auto flex items-center gap-2">
            {!connected && (
              <span className="text-[10px] text-amber-500/70 font-mono">Disconnected</span>
            )}
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-muted-foreground/40 hover:text-foreground/70 transition-colors"
              title={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? (
                <Minimize2 className="h-3 w-3" />
              ) : (
                <Maximize2 className="h-3 w-3" />
              )}
            </button>
          </div>
        )}
      </div>

      {open && (
        <div className="flex-1 min-h-0">
          <XtermTerminal
            ref={terminalRef}
            onData={handleData}
            onResize={handleResize}
            visible={open}
          />
        </div>
      )}
    </div>
  );
});
