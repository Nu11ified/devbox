import Link from "next/link";
import { GitBranch, Bot, Clock } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import type { Run } from "@/lib/api";

function timeAgo(dateStr: string): string {
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000
  );
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function RunCard({ run }: { run: Run }) {
  return (
    <Link href={`/runs/${run.id}`}>
      <Card className="transition-colors hover:bg-accent/50">
        <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="truncate">{run.repo}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <GitBranch className="h-3 w-3 shrink-0" />
              <span className="truncate">{run.branch}</span>
            </div>
          </div>
          <StatusBadge status={run.status} />
        </CardHeader>
        <CardContent className="space-y-2">
          {run.description && (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {run.description}
            </p>
          )}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Bot className="h-3 w-3" />
              {run.backend || "auto"}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {timeAgo(run.createdAt)}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
