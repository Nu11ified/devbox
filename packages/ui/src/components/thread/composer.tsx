"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Send, Square, Loader2, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface ComposerProps {
  onSend: (text: string, model?: string) => void;
  onInterrupt: () => void;
  onStop: () => void;
  running: boolean;
  connected: boolean;
  provider?: string;
  model?: string;
}

const MODELS: Record<string, Array<{ id: string; label: string }>> = {
  claudeCode: [
    { id: "claude-opus-4-6", label: "Opus 4.6" },
    { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
    { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
  ],
  codex: [
    { id: "codex-mini-latest", label: "Codex Mini" },
    { id: "o4-mini", label: "O4 Mini" },
  ],
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
  const availableModels = provider ? MODELS[provider] ?? [] : [];
  // Initialize to the provided model, or the first available model for this provider
  const [selectedModel, setSelectedModel] = useState(
    defaultModel || availableModels[0]?.id || ""
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed, selectedModel || undefined);
    setText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    textareaRef.current?.focus();
  }, [text, selectedModel, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );


  return (
    <div className="border-t border-border/30 bg-background/80 backdrop-blur-sm p-3 pb-4">
      <div className="max-w-3xl mx-auto">
        <div className={cn(
          "relative rounded-xl border transition-colors",
          text.trim() ? "border-primary/30 shadow-sm shadow-primary/5" : "border-border/40",
          "bg-muted/10"
        )}>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={running ? "Agent is working..." : "Message Patchwork..."}
            rows={1}
            className="w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm placeholder:text-muted-foreground/40 focus:outline-none min-h-[44px] max-h-[200px]"
            style={{ height: "auto" }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = "auto";
              target.style.height = Math.min(target.scrollHeight, 200) + "px";
            }}
          />
          <div className="flex items-center justify-between px-3 pb-2">
            <div className="flex items-center gap-2">
              {availableModels.length > 0 && (
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="h-7 rounded-md border-0 bg-muted/40 px-2 text-[11px] font-mono text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-primary/20 cursor-pointer hover:bg-muted/60 transition-colors"
                >
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              )}
              {running && (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={onInterrupt}
                    className="h-7 px-2 rounded-md text-[11px] font-mono text-amber-500/80 hover:bg-amber-500/10 transition-colors flex items-center gap-1"
                    title="Interrupt current turn"
                  >
                    <Square className="h-3 w-3" />
                    Interrupt
                  </button>
                  <button
                    onClick={onStop}
                    className="h-7 px-2 rounded-md text-[11px] font-mono text-red-500/80 hover:bg-red-500/10 transition-colors flex items-center gap-1"
                    title="Stop session"
                  >
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Stop
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={handleSend}
              disabled={!text.trim()}
              className={cn(
                "h-7 w-7 rounded-lg flex items-center justify-center transition-all",
                text.trim()
                  ? "bg-primary text-primary-foreground hover:opacity-90"
                  : "bg-muted/40 text-muted-foreground/30"
              )}
              title="Send (Enter)"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-center mt-2">
          <span className="text-[10px] text-muted-foreground/30">
            Enter to send · Shift+Enter for newline
          </span>
        </div>
      </div>
    </div>
  );
}
