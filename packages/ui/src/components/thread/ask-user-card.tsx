"use client";

import { useState, useRef } from "react";
import { HelpCircle, Send, Check, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface AskUserCardProps {
  requestId: string;
  question: string;
  options?: Array<{ label: string; value: string }>;
  resolved?: boolean;
  response?: string;
  onRespond: (requestId: string, answer: string) => void;
}

export function AskUserCard({
  requestId,
  question,
  options,
  resolved,
  response,
  onRespond,
}: AskUserCardProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [chosenAnswer, setChosenAnswer] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isResolved = resolved || submitted;
  const displayResponse = response || chosenAnswer;

  function handleSubmit(answer: string) {
    if (!answer.trim()) return;
    try {
      onRespond(requestId, answer);
      setChosenAnswer(answer);
      setSubmitted(true);
      setError(null);
    } catch {
      setError("Failed to send response. Try again.");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(text);
    }
  }

  if (isResolved) {
    return (
      <div className="flex gap-3 items-start max-w-3xl mx-auto">
        <div className="w-7 h-7 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
          <HelpCircle className="h-3.5 w-3.5 text-blue-500/40" />
        </div>
        <div className="bg-zinc-800/30 border border-zinc-700/30 rounded-lg px-3 py-2 flex-1">
          <p className="text-sm text-zinc-500 mb-1.5">{question}</p>
          <div className="flex items-center gap-1.5">
            <Check className="h-3 w-3 text-green-500 shrink-0" />
            <span className="text-xs font-mono text-zinc-400">
              {displayResponse}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 items-start max-w-3xl mx-auto">
      <div className="w-7 h-7 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
        <HelpCircle className="h-3.5 w-3.5 text-blue-500/60" />
      </div>
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg px-3 py-2.5 flex-1 space-y-2.5">
        <p className="text-sm text-blue-300">{question}</p>

        {/* Option buttons */}
        {options && options.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {options.map((opt, i) => (
              <button
                key={i}
                onClick={() => handleSubmit(opt.value)}
                className="text-[11px] px-2.5 py-1 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 hover:text-blue-300 transition-colors cursor-pointer"
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {/* Text input — always visible */}
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a custom response..."
            className="flex-1 bg-zinc-900/60 border border-zinc-700/40 rounded-md px-2.5 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/40 transition-colors"
          />
          <button
            onClick={() => handleSubmit(text)}
            disabled={!text.trim()}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              text.trim()
                ? "text-blue-400 hover:bg-blue-500/10"
                : "text-zinc-700 cursor-not-allowed"
            )}
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Error state */}
        {error && (
          <div className="flex items-center gap-1.5 text-xs text-red-400">
            <AlertCircle className="h-3 w-3" />
            <span>{error}</span>
            <button
              onClick={() => handleSubmit(text)}
              className="text-red-300 underline hover:text-red-200"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
