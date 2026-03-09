"use client";

import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface XtermTerminalProps {
  /** Send keystrokes/data to the server */
  onData: (data: string) => void;
  /** Request a resize on the server */
  onResize: (cols: number, rows: number) => void;
  /** Whether the terminal is visible */
  visible: boolean;
}

/**
 * Real interactive terminal backed by xterm.js.
 * Receives output data via the `write()` imperative method.
 */
export interface XtermTerminalHandle {
  write: (data: string) => void;
  clear: () => void;
}

import { forwardRef, useImperativeHandle } from "react";

export const XtermTerminal = forwardRef<XtermTerminalHandle, XtermTerminalProps>(
  function XtermTerminal({ onData, onResize, visible }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const onDataRef = useRef(onData);
    const onResizeRef = useRef(onResize);
    onDataRef.current = onData;
    onResizeRef.current = onResize;

    useImperativeHandle(ref, () => ({
      write: (data: string) => {
        termRef.current?.write(data);
      },
      clear: () => {
        termRef.current?.clear();
      },
    }));

    useEffect(() => {
      if (!containerRef.current) return;

      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace",
        lineHeight: 1.3,
        theme: {
          background: "#0a0a0a",
          foreground: "#e4e4e7",
          cursor: "#e4e4e7",
          selectionBackground: "#27272a",
          black: "#09090b",
          red: "#ef4444",
          green: "#22c55e",
          yellow: "#eab308",
          blue: "#3b82f6",
          magenta: "#a855f7",
          cyan: "#06b6d4",
          white: "#e4e4e7",
          brightBlack: "#52525b",
          brightRed: "#f87171",
          brightGreen: "#4ade80",
          brightYellow: "#facc15",
          brightBlue: "#60a5fa",
          brightMagenta: "#c084fc",
          brightCyan: "#22d3ee",
          brightWhite: "#fafafa",
        },
        allowProposedApi: true,
        scrollback: 10000,
        convertEol: true,
      });

      const fit = new FitAddon();
      term.loadAddon(fit);

      term.open(containerRef.current);

      // Small delay to ensure container has rendered dimensions
      requestAnimationFrame(() => {
        try {
          fit.fit();
        } catch {
          // ignore fit errors on unmount
        }
      });

      term.onData((data) => {
        onDataRef.current(data);
      });

      // Debounce resize events to avoid spamming during CSS transitions
      let resizeTimer: ReturnType<typeof setTimeout> | null = null;
      term.onResize(({ cols, rows }) => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          onResizeRef.current(cols, rows);
        }, 300);
      });

      termRef.current = term;
      fitRef.current = fit;

      return () => {
        term.dispose();
        termRef.current = null;
        fitRef.current = null;
      };
    }, []);

    // Re-fit when visibility changes
    useEffect(() => {
      if (visible && fitRef.current) {
        // Delay fit to allow CSS transition to complete
        const timer = setTimeout(() => {
          try {
            fitRef.current?.fit();
          } catch {
            // ignore
          }
        }, 250);
        return () => clearTimeout(timer);
      }
    }, [visible]);

    // Resize observer for container size changes
    useEffect(() => {
      if (!containerRef.current) return;
      const observer = new ResizeObserver(() => {
        if (fitRef.current) {
          try {
            fitRef.current.fit();
          } catch {
            // ignore
          }
        }
      });
      observer.observe(containerRef.current);
      return () => observer.disconnect();
    }, []);

    return (
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ backgroundColor: "#0a0a0a" }}
      />
    );
  }
);
