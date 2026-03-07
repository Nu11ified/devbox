"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Send, Square, Loader2 } from "lucide-react";

interface ComposerProps {
  onSend: (text: string, model?: string) => void;
  onInterrupt: () => void;
  onStop: () => void;
  running: boolean;
  connected: boolean;
  provider?: string;
  model?: string;
}

const MODELS: Record<string, string[]> = {
  claudeCode: [
    "claude-sonnet-4-20250514",
    "claude-opus-4-20250514",
    "claude-haiku-4-20250514",
  ],
  codex: ["codex-mini-latest", "o4-mini"],
};

export function Composer({
  onSend,
  onInterrupt,
  onStop,
  running,
  connected,
  provider,
  model: defaultModel,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [selectedModel, setSelectedModel] = useState(defaultModel ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed, selectedModel || undefined);
    setText("");
    textareaRef.current?.focus();
  }, [text, selectedModel, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const availableModels = provider ? MODELS[provider] ?? [] : [];

  return (
    <div className="border-t border-border/40 bg-background p-3">
      <div className="flex items-end gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={connected ? "Send a message..." : "Connecting..."}
            disabled={!connected}
            rows={1}
            className="w-full resize-none rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5 text-sm font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30 min-h-[40px] max-h-[200px]"
            style={{ height: "auto" }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = "auto";
              target.style.height = Math.min(target.scrollHeight, 200) + "px";
            }}
          />
        </div>

        <div className="flex items-center gap-1.5">
          {availableModels.length > 0 && (
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="h-9 rounded-md border border-border/40 bg-muted/20 px-2 text-[11px] font-mono text-muted-foreground"
            >
              {availableModels.map((m) => (
                <option key={m} value={m}>
                  {m.split("-").slice(0, 2).join(" ")}
                </option>
              ))}
            </select>
          )}

          {running ? (
            <>
              <Button
                size="icon"
                variant="outline"
                className="h-9 w-9 border-amber-500/30 text-amber-500 hover:bg-amber-500/10"
                onClick={onInterrupt}
                title="Interrupt"
              >
                <Square className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                className="h-9 w-9 border-red-500/30 text-red-500 hover:bg-red-500/10"
                onClick={onStop}
                title="Stop session"
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              </Button>
            </>
          ) : (
            <Button
              size="icon"
              className="h-9 w-9"
              onClick={handleSend}
              disabled={!text.trim() || !connected}
              title="Send (Cmd+Enter)"
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
