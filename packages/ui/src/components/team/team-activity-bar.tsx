"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, MessageSquare, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ActivityItem {
  id: string;
  type: "message" | "task";
  fromName: string;
  toName?: string;
  content: string;
  timestamp: Date;
}

interface TeamActivityBarProps {
  items: ActivityItem[];
}

export function TeamActivityBar({ items }: TeamActivityBarProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (items.length === 0) return null;

  return (
    <div className="border-t border-zinc-800/40 bg-zinc-950/60">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-zinc-800/30 transition-colors"
      >
        {collapsed ? (
          <ChevronUp className="h-3 w-3 text-zinc-500" />
        ) : (
          <ChevronDown className="h-3 w-3 text-zinc-500" />
        )}
        <span className="text-[10px] font-mono uppercase text-zinc-500 tracking-wider">
          Team Activity ({items.length})
        </span>
      </button>

      {!collapsed && (
        <div className="max-h-32 overflow-y-auto px-3 pb-2 space-y-1">
          {items.slice(-20).map((item) => (
            <div key={item.id} className="flex items-start gap-2 text-[11px]">
              {item.type === "message" ? (
                <MessageSquare className="h-3 w-3 text-violet-500/60 mt-0.5 shrink-0" />
              ) : (
                <CheckCircle2 className="h-3 w-3 text-emerald-500/60 mt-0.5 shrink-0" />
              )}
              <span className="text-zinc-400">
                <span className="text-zinc-300 font-medium">{item.fromName}</span>
                {item.toName && item.toName !== "all" && (
                  <>
                    {" → "}
                    <span className="text-zinc-300 font-medium">{item.toName}</span>
                  </>
                )}
                {": "}
                <span className="text-zinc-500">{item.content}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
