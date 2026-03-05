"use client";

import { use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  GitBranch,
  CircleDot,
  CheckCircle2,
  Clock,
  Loader2,
  XCircle,
  Play,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TimeAgo } from "@/components/ui/time-ago";
import { cn } from "@/lib/utils";

const statusConfig: Record<string, { icon: typeof CircleDot; label: string; color: string; bg: string }> = {
  open: { icon: CircleDot, label: "Open", color: "text-blue-500", bg: "bg-blue-500/10" },
  queued: { icon: Clock, label: "Queued", color: "text-yellow-500", bg: "bg-yellow-500/10" },
  in_progress: { icon: Loader2, label: "In Progress", color: "text-orange-500", bg: "bg-orange-500/10" },
  review: { icon: Play, label: "Review", color: "text-purple-500", bg: "bg-purple-500/10" },
  done: { icon: CheckCircle2, label: "Done", color: "text-green-500", bg: "bg-green-500/10" },
  cancelled: { icon: XCircle, label: "Cancelled", color: "text-muted-foreground", bg: "bg-muted" },
  error: { icon: AlertTriangle, label: "Error", color: "text-red-500", bg: "bg-red-500/10" },
};

const priorityLabels: Record<number, string> = {
  0: "Urgent",
  1: "High",
  2: "Medium",
  3: "Low",
};

const priorityColors: Record<number, string> = {
  0: "bg-red-500/10 text-red-500",
  1: "bg-orange-500/10 text-orange-500",
  2: "bg-blue-500/10 text-blue-500",
  3: "bg-muted text-muted-foreground",
};

export default function IssueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: issue, loading, error, refetch } = useApi(
    () => api.getIssue(id),
    [id]
  );

  async function transition(status: string) {
    await api.updateIssue(id, { status });
    refetch();
  }

  async function dispatch() {
    await api.dispatchIssue(id);
    refetch();
  }

  if (loading && !issue) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !issue) {
    return (
      <div className="p-6">
        <div className="text-center py-12">
          <p className="text-destructive">{error?.message || "Issue not found"}</p>
          <Button variant="outline" size="sm" className="mt-4" asChild>
            <Link href="/board">Back to Board</Link>
          </Button>
        </div>
      </div>
    );
  }

  const status = statusConfig[issue.status] || statusConfig.open;
  const StatusIcon = status.icon;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      {/* Back + breadcrumb */}
      <div className="flex items-center gap-2 mb-4">
        <Button variant="ghost" size="sm" className="h-7 px-2" asChild>
          <Link href="/board">
            <ArrowLeft className="h-3.5 w-3.5" />
          </Link>
        </Button>
        <span className="text-[11px] font-mono text-muted-foreground/50">Board</span>
        <span className="text-[11px] text-muted-foreground/30">/</span>
        <span className="text-[11px] font-mono text-muted-foreground">{issue.identifier}</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">
          {issue.title}
          <span className="text-muted-foreground/40 font-normal ml-2">
            {issue.identifier}
          </span>
        </h1>

        {/* Status + metadata row */}
        <div className="flex flex-wrap items-center gap-3 mt-3">
          {/* Status pill */}
          <span className={cn(
            "inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-full",
            status.bg, status.color
          )}>
            <StatusIcon className={cn("h-3 w-3", issue.status === "in_progress" && "animate-spin")} />
            {status.label}
          </span>

          {/* Priority */}
          <span className={cn(
            "text-[10px] font-mono px-2 py-0.5 rounded-full",
            priorityColors[issue.priority] || priorityColors[3]
          )}>
            {priorityLabels[issue.priority] ?? "Low"} priority
          </span>

          {/* Timestamp */}
          <span className="text-[11px] text-muted-foreground/50 flex items-center gap-1">
            opened <TimeAgo date={issue.createdAt} />
          </span>

          {/* GitHub link */}
          {issue.githubIssueUrl && (
            <a
              href={issue.githubIssueUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground/60 hover:text-foreground transition-colors"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              #{issue.githubIssueId}
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-6">
        {/* Main content */}
        <div className="space-y-6">
          {/* Body */}
          {issue.body && (
            <Card>
              <CardContent className="p-4">
                <div className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">
                  {issue.body}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Error info */}
          {issue.lastError && (
            <Card className="border-destructive/30">
              <CardHeader className="p-3 pb-1">
                <CardTitle className="text-sm text-destructive flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Last Error
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-1">
                <pre className="text-xs font-mono text-destructive/80 whitespace-pre-wrap bg-destructive/5 rounded p-2">
                  {issue.lastError}
                </pre>
                {issue.retryCount > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-2">
                    Retry count: {issue.retryCount}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Run link */}
          {issue.runId && (
            <Card>
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Active run</span>
                  <Link
                    href={`/runs/${issue.runId}`}
                    className="inline-flex items-center gap-1.5 text-sm font-mono text-primary hover:underline"
                  >
                    <Play className="h-3 w-3" />
                    View run
                  </Link>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {issue.status === "open" && (
              <>
                <Button size="sm" onClick={() => transition("queued")}>
                  <Clock className="mr-1.5 h-3.5 w-3.5" />
                  Queue
                </Button>
                <Button size="sm" variant="outline" onClick={dispatch}>
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                  Dispatch Now
                </Button>
              </>
            )}
            {issue.status === "review" && (
              <Button size="sm" onClick={() => transition("done")}>
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                Mark Done
              </Button>
            )}
            {issue.status === "error" && (
              <Button size="sm" variant="outline" onClick={() => transition("queued")}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Retry
              </Button>
            )}
            {issue.status !== "done" && issue.status !== "cancelled" && (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => transition("cancelled")}>
                <XCircle className="mr-1.5 h-3.5 w-3.5" />
                Cancel
              </Button>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Details */}
          <Card>
            <CardContent className="p-3 space-y-3">
              <SidebarField label="Repository">
                <div className="flex items-center gap-1.5">
                  <svg className="w-3 h-3 text-muted-foreground/50" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                  </svg>
                  <a
                    href={`https://github.com/${issue.repo}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-mono hover:underline hover:text-foreground transition-colors"
                  >
                    {issue.repo}
                  </a>
                </div>
              </SidebarField>

              <SidebarField label="Branch">
                <div className="flex items-center gap-1">
                  <GitBranch className="h-3 w-3 text-muted-foreground/50" />
                  <span className="text-[11px] font-mono">{issue.branch}</span>
                </div>
              </SidebarField>

              <SidebarField label="Blueprint">
                <span className="text-[11px] font-mono">{issue.blueprintId}</span>
              </SidebarField>

              {issue.assignee && (
                <SidebarField label="Assignee">
                  <span className="text-[11px] font-mono">{issue.assignee}</span>
                </SidebarField>
              )}

              {issue.templateId && (
                <SidebarField label="Template">
                  <span className="text-[11px] font-mono text-primary">{issue.templateId}</span>
                </SidebarField>
              )}
            </CardContent>
          </Card>

          {/* Labels */}
          {issue.labels && issue.labels.length > 0 && (
            <Card>
              <CardContent className="p-3">
                <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/50 mb-2">Labels</p>
                <div className="flex flex-wrap gap-1">
                  {issue.labels.map((label) => (
                    <span
                      key={label}
                      className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground/70 border border-border/30"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* GitHub sync info */}
          {issue.githubIssueUrl && (
            <Card>
              <CardContent className="p-3">
                <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/50 mb-2">GitHub</p>
                <div className="space-y-2">
                  <a
                    href={issue.githubIssueUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-[11px] font-mono text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    View on GitHub #{issue.githubIssueId}
                  </a>
                  {issue.githubSyncedAt && (
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
                      <RefreshCw className="h-2.5 w-2.5" />
                      <span>Synced</span> <TimeAgo date={issue.githubSyncedAt} />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Timestamps */}
          <Card>
            <CardContent className="p-3 space-y-1.5">
              <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/50 mb-2">Dates</p>
              <div className="flex justify-between text-[10px] text-muted-foreground/60">
                <span>Created</span>
                <TimeAgo date={issue.createdAt} />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground/60">
                <span>Updated</span>
                <TimeAgo date={issue.updatedAt} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SidebarField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/50 mb-0.5">{label}</p>
      <div className="text-foreground/80">{children}</div>
    </div>
  );
}
