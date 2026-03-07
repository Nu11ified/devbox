"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  PlusCircle,
  ExternalLink,
  GitPullRequest,
  CircleDot,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
} from "lucide-react";
import { api, type IssueItem, type CreateIssueRequest } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { GitHubImportDialog } from "@/components/github-import-dialog";
import { TimeAgo } from "@/components/ui/time-ago";
import { cn } from "@/lib/utils";

const columns: { label: string; status: string; icon: typeof CircleDot; color: string }[] = [
  { label: "Open", status: "open", icon: CircleDot, color: "text-blue-500" },
  { label: "Queued", status: "queued", icon: Clock, color: "text-yellow-500" },
  { label: "In Progress", status: "in_progress", icon: Loader2, color: "text-orange-500" },
  { label: "Review", status: "review", icon: GitPullRequest, color: "text-purple-500" },
  { label: "Done", status: "done", icon: CheckCircle2, color: "text-green-500" },
];

const priorityLabels: Record<number, string> = {
  0: "Urgent",
  1: "High",
  2: "Medium",
  3: "Low",
};

const priorityColors: Record<number, string> = {
  0: "bg-red-500/10 text-red-500 border-red-500/20",
  1: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  2: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  3: "bg-muted text-muted-foreground border-border",
};

export default function BoardPage() {
  const { data: issues, loading, error, refetch } = useApi(
    () => api.listIssues(),
    []
  );
  const { data: repos } = useApi(() => api.listGitHubRepos(), []);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<CreateIssueRequest>({
    title: "",
    body: "",
    repo: "",
    branch: "",
    priority: 2,
    blueprintId: "simple",
  });

  useEffect(() => {
    const interval = setInterval(() => refetch(), 5000);
    return () => clearInterval(interval);
  }, [refetch]);

  function issuesForStatus(status: string): IssueItem[] {
    return (issues ?? []).filter((i) => i.status === status);
  }

  async function handleCreate() {
    const req: CreateIssueRequest = {
      title: form.title,
      repo: form.repo,
    };
    if (form.body) req.body = form.body;
    if (form.branch) req.branch = form.branch;
    if (form.priority !== undefined) req.priority = form.priority;
    if (form.blueprintId) req.blueprintId = form.blueprintId;
    await api.createIssue(req);
    setDialogOpen(false);
    setForm({ title: "", body: "", repo: "", branch: "", priority: 2, blueprintId: "simple" });
    refetch();
  }

  async function transition(id: string, status: string) {
    await api.updateIssue(id, { status });
    refetch();
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Board</h1>
          <p className="text-sm text-muted-foreground/70 mt-0.5">
            {issues ? `${issues.length} issue${issues.length !== 1 ? "s" : ""}` : "Loading..."}
          </p>
        </div>
        <div className="flex gap-2">
          <GitHubImportDialog onImported={refetch} />
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <PlusCircle className="mr-2 h-4 w-4" />
                New Issue
              </Button>
            </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Issue</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Issue title"
                />
              </div>
              <div className="space-y-2">
                <Label>Body</Label>
                <Textarea
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  placeholder="Description..."
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Repo</Label>
                <Select
                  value={form.repo}
                  onValueChange={(v) => setForm({ ...form, repo: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a repository" />
                  </SelectTrigger>
                  <SelectContent>
                    {repos?.map((r: any) => (
                      <SelectItem key={r.full_name} value={r.full_name}>
                        {r.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Branch</Label>
                <Input
                  value={form.branch}
                  onChange={(e) => setForm({ ...form, branch: e.target.value })}
                  placeholder="main"
                />
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={String(form.priority)}
                  onValueChange={(v) => setForm({ ...form, priority: Number(v) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Urgent</SelectItem>
                    <SelectItem value="1">High</SelectItem>
                    <SelectItem value="2">Medium</SelectItem>
                    <SelectItem value="3">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Blueprint</Label>
                <Select
                  value={form.blueprintId}
                  onValueChange={(v) => setForm({ ...form, blueprintId: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="simple">simple</SelectItem>
                    <SelectItem value="minion">minion</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleCreate} disabled={!form.title || !form.repo} className="w-full">
                Create
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {loading && !issues && (
        <div className="py-12 text-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
          Loading issues...
        </div>
      )}

      {error && (
        <div className="py-12 text-center text-destructive">
          Failed to load issues: {error.message}
        </div>
      )}

      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((col) => {
          const colIssues = issuesForStatus(col.status);
          const ColIcon = col.icon;
          return (
            <div key={col.status} className="flex-shrink-0 w-72">
              <div className="flex items-center gap-2 mb-3">
                <ColIcon className={cn("h-3.5 w-3.5", col.color)} />
                <h2 className="text-sm font-semibold">{col.label}</h2>
                <span className="text-[10px] font-mono text-muted-foreground/60 bg-muted/50 px-1.5 py-0.5 rounded-full">
                  {colIssues.length}
                </span>
              </div>
              <ScrollArea className="h-[calc(100vh-12rem)]">
                <div className="space-y-2 pr-2">
                  {colIssues.map((issue) => (
                    <IssueCard
                      key={issue.id}
                      issue={issue}
                      onTransition={transition}
                    />
                  ))}
                </div>
              </ScrollArea>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IssueCard({
  issue,
  onTransition,
}: {
  issue: IssueItem;
  onTransition: (id: string, status: string) => void;
}) {
  return (
    <Card className="shadow-sm hover:shadow-md transition-shadow border border-border/60 hover:border-border">
      <CardHeader className="p-3 pb-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-muted-foreground/50">
                {issue.identifier}
              </span>
              {issue.githubIssueUrl && (
                <a
                  href={issue.githubIssueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-[9px] font-mono px-1 py-0.5 rounded-sm border border-border/40 text-muted-foreground/50 hover:text-foreground hover:border-border transition-colors"
                  title="View on GitHub"
                >
                  <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                  </svg>
                  #{issue.githubIssueId}
                </a>
              )}
            </div>
            <CardTitle className="text-sm leading-tight mt-0.5">
              <Link
                href={`/board/${issue.id}`}
                className="hover:underline"
              >
                {issue.title}
              </Link>
            </CardTitle>
          </div>
          <span className={cn(
            "shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded-full border",
            priorityColors[issue.priority] || priorityColors[3]
          )}>
            {priorityLabels[issue.priority] ?? "Low"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-1">
        {/* Repo + branch */}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60">
          <span className="font-mono truncate">{issue.repo}</span>
          {issue.branch && issue.branch !== "main" && (
            <>
              <span className="text-muted-foreground/30">/</span>
              <span className="font-mono truncate">{issue.branch}</span>
            </>
          )}
        </div>

        {/* Labels */}
        {issue.labels && issue.labels.length > 0 && (
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {issue.labels.map((label) => (
              <span
                key={label}
                className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-muted/50 text-muted-foreground/70 border border-border/30"
              >
                {label}
              </span>
            ))}
          </div>
        )}

        {/* Footer: timestamp + actions */}
        <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-border/30">
          <div className="flex items-center gap-2">
            <TimeAgo date={issue.createdAt} />
            {issue.assignee && (
              <span className="text-[10px] font-mono text-muted-foreground/50 truncate max-w-[80px]">
                {issue.assignee}
              </span>
            )}
          </div>
          <div className="flex gap-1">
            {issue.status === "open" && (
              <Button size="sm" variant="outline" className="h-5 text-[10px] px-1.5" onClick={() => onTransition(issue.id, "queued")}>
                Queue
              </Button>
            )}
            {issue.status === "review" && (
              <Button size="sm" variant="outline" className="h-5 text-[10px] px-1.5" onClick={() => onTransition(issue.id, "done")}>
                Done
              </Button>
            )}
            {issue.status !== "done" && issue.status !== "cancelled" && (
              <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5 text-destructive/70 hover:text-destructive" onClick={() => onTransition(issue.id, "cancelled")}>
                <XCircle className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
