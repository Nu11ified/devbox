"use client";

import { Button } from "@/components/ui/button";
import { Shield, Terminal, FileEdit, Plug, Check, X } from "lucide-react";

interface ApprovalCardProps {
  requestId: string;
  toolName: string;
  toolCategory: string;
  description?: string;
  input?: Record<string, unknown>;
  resolved?: boolean;
  decision?: string;
  onApprove: (requestId: string, decision: "allow" | "deny" | "allow_session") => void;
}

const categoryIcons: Record<string, typeof Terminal> = {
  command_execution: Terminal,
  file_change: FileEdit,
  mcp_tool_call: Plug,
};

export function ApprovalCard({
  requestId,
  toolName,
  toolCategory,
  description,
  input,
  resolved,
  decision,
  onApprove,
}: ApprovalCardProps) {
  const Icon = categoryIcons[toolCategory] ?? Shield;

  return (
    <div className="ml-10 border rounded-lg p-3 bg-amber-500/5 border-amber-500/15 space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-amber-500/10 flex items-center justify-center">
          <Icon className="h-3.5 w-3.5 text-amber-500" />
        </div>
        <span className="text-sm font-medium text-foreground/90">{toolName}</span>
        <span className="text-[10px] font-mono text-muted-foreground/40 uppercase tracking-wider">
          {toolCategory.replace(/_/g, " ")}
        </span>
      </div>

      {description && (
        <p className="text-xs text-muted-foreground/70 font-mono leading-relaxed">{description}</p>
      )}

      {input && toolCategory === "command_execution" && !!input.command && (
        <pre className="text-[11px] bg-[#0d1117] text-green-400/90 rounded-md px-3 py-2 font-mono overflow-x-auto">
          $ {String(input.command)}
        </pre>
      )}

      {resolved ? (
        <div className="flex items-center gap-1.5">
          {decision === "deny" ? (
            <X className="h-3 w-3 text-red-500" />
          ) : (
            <Check className="h-3 w-3 text-green-500" />
          )}
          <span className="text-xs font-mono text-muted-foreground/50">
            {decision === "allow" ? "Allowed" : decision === "deny" ? "Denied" : "Allowed for session"}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
            onClick={() => onApprove(requestId, "allow")}
          >
            Allow
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-primary/20 text-primary hover:bg-primary/10"
            onClick={() => onApprove(requestId, "allow_session")}
          >
            Allow All
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-red-500/20 text-red-500 hover:bg-red-500/10"
            onClick={() => onApprove(requestId, "deny")}
          >
            Deny
          </Button>
        </div>
      )}
    </div>
  );
}
