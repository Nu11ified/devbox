"use client";

import { Button } from "@/components/ui/button";
import { Shield, Terminal, FileEdit, Plug } from "lucide-react";

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
    <div className="border rounded-lg p-3 bg-amber-500/5 border-amber-500/20 space-y-2">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-amber-500" />
        <span className="text-sm font-medium">{toolName}</span>
        <span className="text-[10px] font-mono text-muted-foreground/60 uppercase">
          {toolCategory.replace("_", " ")}
        </span>
      </div>

      {description && (
        <p className="text-xs text-muted-foreground font-mono">{description}</p>
      )}

      {input && toolCategory === "command_execution" && !!input.command && (
        <pre className="text-xs bg-black/80 text-green-400 rounded px-3 py-2 font-mono overflow-x-auto">
          $ {String(input.command)}
        </pre>
      )}

      {resolved ? (
        <div className="text-xs font-mono text-muted-foreground/60">
          {decision === "allow" ? "Allowed" : decision === "deny" ? "Denied" : "Allowed for session"}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-green-500/30 text-green-600 hover:bg-green-500/10"
            onClick={() => onApprove(requestId, "allow")}
          >
            Allow
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-blue-500/30 text-blue-600 hover:bg-blue-500/10"
            onClick={() => onApprove(requestId, "allow_session")}
          >
            Allow All
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs border-red-500/30 text-red-600 hover:bg-red-500/10"
            onClick={() => onApprove(requestId, "deny")}
          >
            Deny
          </Button>
        </div>
      )}
    </div>
  );
}
