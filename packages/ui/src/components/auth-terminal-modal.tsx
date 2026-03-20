"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Terminal as TerminalIcon } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

interface AuthTerminalModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: "claude" | "codex";
  onSuccess: () => void;
}

export function AuthTerminalModal({
  open,
  onOpenChange,
  provider,
  onSuccess,
}: AuthTerminalModalProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<any>(null);
  const statusRef = useRef<string>("connecting");
  const [status, setStatus] = useState<"connecting" | "ready" | "success" | "error" | "timeout">("connecting");
  const [countdown, setCountdown] = useState(300);

  // Keep statusRef in sync for use in callbacks
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const cleanup = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (terminalRef.current) {
      terminalRef.current.dispose();
      terminalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open) {
      cleanup();
      setStatus("connecting");
      setCountdown(300);
      return;
    }

    let countdownInterval: ReturnType<typeof setInterval>;

    const initTerminal = async () => {
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      if (!termRef.current || !open) return;

      const terminal = new Terminal({
        cursorBlink: true,
        theme: {
          background: "#18181b",
          foreground: "#fafafa",
        },
        fontSize: 13,
        fontFamily: "JetBrains Mono, monospace",
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(termRef.current);
      fitAddon.fit();
      terminalRef.current = terminal;

      terminal.writeln(`Connecting to ${provider} auth...`);

      // Get WS ticket
      const ticketRes = await fetch("/api/ws-ticket", { method: "POST" });
      const { ticket } = await ticketRes.json();

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/auth/terminal/${provider}?ticket=${ticket}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case "auth.ready":
              setStatus("ready");
              terminal.writeln("Container ready. Complete the login flow below:\n");
              break;
            case "data":
              terminal.write(msg.data);
              break;
            case "auth.success":
              setStatus("success");
              terminal.writeln("\n\nAuthentication successful!");
              setTimeout(() => {
                onSuccess();
                onOpenChange(false);
              }, 1500);
              break;
            case "auth.timeout":
              setStatus("timeout");
              terminal.writeln("\n\nTimeout — auth container destroyed.");
              break;
            case "auth.error":
              setStatus("error");
              terminal.writeln(`\n\nError: ${msg.message}`);
              break;
          }
        } catch {}
      };

      ws.onerror = () => {
        setStatus("error");
        terminal.writeln("\nWebSocket connection error.");
      };

      ws.onclose = () => {
        if (statusRef.current !== "success") {
          terminal.writeln("\nConnection closed.");
        }
      };

      terminal.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "data", data }));
        }
      });

      countdownInterval = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(countdownInterval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    };

    initTerminal();

    return () => {
      cleanup();
      if (countdownInterval) clearInterval(countdownInterval);
    };
  }, [open, provider]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TerminalIcon className="h-5 w-5" />
            Connect {provider === "claude" ? "Claude" : "Codex"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between text-sm text-zinc-400 mb-2">
          <span>
            {status === "connecting" && "Connecting..."}
            {status === "ready" && "Complete the login in the terminal below"}
            {status === "success" && "Connected successfully!"}
            {status === "error" && "Connection error"}
            {status === "timeout" && "Timed out"}
          </span>
          {status === "ready" && (
            <span className="tabular-nums">{formatTime(countdown)} remaining</span>
          )}
        </div>

        <div
          ref={termRef}
          className="h-[400px] rounded-md border border-zinc-800 bg-zinc-950 overflow-hidden"
        />

        <div className="flex justify-end gap-2 mt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={status === "success"}
          >
            {status === "success" ? "Done" : "Cancel"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
