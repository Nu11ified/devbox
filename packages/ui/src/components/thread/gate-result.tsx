"use client";

import { useState } from "react";
import { CheckCircle2, XCircle, ChevronDown, ChevronRight } from "lucide-react";

interface GateResultProps {
  checkType: string;
  passed: boolean;
  summary: string;
  details?: string;
  errorCount?: number;
  warningCount?: number;
}

const CHECK_TYPE_LABELS: Record<string, string> = {
  typecheck: "Typecheck",
  lint: "Lint",
  test: "Tests",
  build: "Build",
  custom: "Custom",
};

export function GateResult({ checkType, passed, summary, details, errorCount, warningCount }: GateResultProps) {
  const [expanded, setExpanded] = useState(!passed);

  const Icon = passed ? CheckCircle2 : XCircle;
  const borderColor = passed ? "border-green-500/30" : "border-red-500/30";
  const iconColor = passed ? "text-green-400" : "text-red-400";
  const label = CHECK_TYPE_LABELS[checkType] ?? checkType;

  return (
    <div className={`rounded border ${borderColor} bg-zinc-900/50 overflow-hidden max-w-3xl mx-auto`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
        )}
        <Icon className={`w-4 h-4 ${iconColor} shrink-0`} />
        <span className="text-xs font-mono text-zinc-300 font-medium">{label}</span>
        <span className="text-xs font-mono text-zinc-500 flex-1">{summary}</span>
        {errorCount !== undefined && errorCount > 0 && (
          <span className="text-xs font-mono text-red-400">{errorCount} errors</span>
        )}
        {warningCount !== undefined && warningCount > 0 && (
          <span className="text-xs font-mono text-yellow-400 ml-1">{warningCount} warnings</span>
        )}
      </button>
      {expanded && details && (
        <div className="border-t border-zinc-800 px-3 py-2">
          <pre className="text-[11px] font-mono text-zinc-400 whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto">
            {details}
          </pre>
        </div>
      )}
    </div>
  );
}
