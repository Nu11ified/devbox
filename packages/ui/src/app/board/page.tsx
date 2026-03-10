"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  PlusCircle,
  ExternalLink,
  GitPullRequest,
  CircleDot,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  GitBranch,
  Zap,
} from "lucide-react";
import { api, type IssueItem, type CreateIssueRequest, type ProjectItem } from "@/lib/api";
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
  3: "bg-zinc-800/50 text-zinc-400 border-zinc-700/30",
};

export default function BoardPage() {
  const router = useRouter();
  const { data: issues, loading, error, refetch } = useApi(
    () => api.listIssues(),
    []
  );
  const { data: projects } = useApi(() => api.listProjects(), []);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<CreateIssueRequest & { projectId?: string }>({
    title: "",
    body: "",
    repo: "",
    branch: "",
    priority: 2,
    blueprintId: "simple",
    projectId: "",
  });

  // Build project lookup map
  const projectMap = useMemo(() => {
    const map = new Map<string, ProjectItem>();
    for (const p of projects ?? []) {
      map.set(p.id, p);
    }
    return map;
  }, [projects]);

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
    };
    if (form.projectId) {
      req.projectId = form.projectId;
      // repo is derived from project on server, but send it for backward compat
      const proj = projectMap.get(form.projectId);
      if (proj) {
        req.repo = proj.repo;
        req.branch = proj.branch;
      }
    } else {
      req.repo = form.repo;
      if (form.branch) req.branch = form.branch;
    }
    if (form.body) req.body = form.body;
    if (form.priority !== undefined) req.priority = form.priority;
    if (form.blueprintId) req.blueprintId = form.blueprintId;
    await api.createIssue(req);
    setDialogOpen(false);
    setForm({ title: "", body: "", repo: "", branch: "", priority: 2, blueprintId: "simple", projectId: "" });
    refetch();
  }

  async function transition(id: string, status: string) {
    await api.updateIssue(id, { status });
    refetch();
  }

  async function handleDispatch(id: string) {
    try {
      await api.dispatchIssue(id);
      refetch();
    } catch (err) {
      console.error("Dispatch failed:", err);
    }
  }

  function handleCardClick(issue: IssueItem) {
    if (
      issue.thread &&
      issue.projectId &&
      (issue.status === "in_progress" || issue.status === "review")
    ) {
      router.push(`/projects/${issue.projectId}/threads/${issue.thread.id}`);
    }
  }

  // Auto-fill repo when project is selected in the form
  function handleProjectSelect(projectId: string) {
    const proj = projectMap.get(projectId);
    setForm({
      ...form,
      projectId,
      repo: proj?.repo ?? "",
      branch: proj?.branch ?? "",
    });
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
                <Label>Project</Label>
                <Select
                  value={form.projectId || ""}
                  onValueChange={handleProjectSelect}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {(projects ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} ({p.repo})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.projectId && (
                  <p className="text-xs text-muted-foreground/60">
                    Repo: {form.repo} / {form.branch || "main"}
                  </p>
                )}
              </div>
              {!form.projectId && (
                <>
                  <div className="space-y-2">
                    <Label>Repo</Label>
                    <Input
                      value={form.repo}
                      onChange={(e) => setForm({ ...form, repo: e.target.value })}
                      placeholder="owner/repo"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Branch</Label>
                    <Input
                      value={form.branch}
                      onChange={(e) => setForm({ ...form, branch: e.target.value })}
                      placeholder="main"
                    />
                  </div>
                </>
              )}
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
              <Button
                onClick={handleCreate}
                disabled={!form.title || (!form.repo && !form.projectId)}
                className="w-full"
              >
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
                <span className="text-[10px] font-mono text-muted-foreground/60 bg-zinc-800/50 px-1.5 py-0.5 rounded-full">
                  {colIssues.length}
                </span>
              </div>
              <ScrollArea className="h-[calc(100vh-12rem)]">
                <div className="space-y-2 pr-2">
                  {colIssues.map((issue) => (
                    <IssueCard
                      key={issue.id}
                      issue={issue}
                      project={issue.projectId ? projectMap.get(issue.projectId) : undefined}
                      onTransition={transition}
                      onDispatch={handleDispatch}
                      onClick={handleCardClick}
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

/** Thread status dot colors */
function threadStatusDot(status: string) {
  switch (status) {
    case "running":
      return "bg-emerald-500 animate-pulse";
    case "waiting":
      return "bg-amber-500 animate-pulse";
    case "idle":
      return "bg-zinc-500";
    case "error":
      return "bg-red-500";
    default:
      return "bg-zinc-600";
  }
}

function IssueCard({
  issue,
  project,
  onTransition,
  onDispatch,
  onClick,
}: {
  issue: IssueItem;
  project?: ProjectItem;
  onTransition: (id: string, status: string) => void;
  onDispatch: (id: string) => void;
  onClick: (issue: IssueItem) => void;
}) {
  const isClickable =
    issue.thread &&
    issue.projectId &&
    (issue.status === "in_progress" || issue.status === "review");

  return (
    <Card
      className={cn(
        "bg-zinc-900/50 border-zinc-800/40 shadow-sm hover:shadow-md transition-all hover:border-zinc-700/60",
        isClickable && "cursor-pointer hover:bg-zinc-900/70"
      )}
      onClick={() => isClickable && onClick(issue)}
    >
      <CardHeader className="p-3 pb-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-zinc-500">
                {issue.identifier}
              </span>
              {issue.githubIssueUrl && (
                <a
                  href={issue.githubIssueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-[9px] font-mono px-1 py-0.5 rounded-sm border border-zinc-700/40 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 transition-colors"
                  title="View on GitHub"
                  onClick={(e) => e.stopPropagation()}
                >
                  <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                  </svg>
                  #{issue.githubIssueId}
                </a>
              )}
              {/* Live thread status dot */}
              {issue.thread && (issue.status === "in_progress" || issue.status === "review") && (
                <span
                  className={cn(
                    "inline-block w-2 h-2 rounded-full ml-auto shrink-0",
                    threadStatusDot(issue.thread.status)
                  )}
                  title={`Thread: ${issue.thread.status}`}
                />
              )}
            </div>
            <CardTitle className="text-sm leading-tight mt-0.5">
              <span className="hover:underline">
                {issue.title}
              </span>
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
        {/* Project name or repo + branch */}
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          {project ? (
            <span className="font-medium text-zinc-400 truncate">{project.name}</span>
          ) : (
            <span className="font-mono truncate">{issue.repo}</span>
          )}
          {(project ? project.branch !== "main" : issue.branch && issue.branch !== "main") && (
            <>
              <span className="text-zinc-600">/</span>
              <span className="font-mono truncate">{project?.branch ?? issue.branch}</span>
            </>
          )}
        </div>

        {/* Worktree branch badge */}
        {issue.thread?.worktreeBranch && (
          <div className="mt-1.5">
            <span className="inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded-md bg-zinc-800/60 text-zinc-400 border border-zinc-700/30">
              <GitBranch className="w-2.5 h-2.5" />
              {issue.thread.worktreeBranch}
            </span>
          </div>
        )}

        {/* Labels */}
        {issue.labels && issue.labels.length > 0 && (
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {issue.labels.map((label) => (
              <span
                key={label}
                className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-zinc-800/50 text-zinc-500 border border-zinc-700/30"
              >
                {label}
              </span>
            ))}
          </div>
        )}

        {/* Footer: timestamp + actions */}
        <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-zinc-800/40">
          <div className="flex items-center gap-2">
            <TimeAgo date={issue.createdAt} />
            {issue.assignee && (
              <span className="text-[10px] font-mono text-zinc-500 truncate max-w-[80px]">
                {issue.assignee}
              </span>
            )}
          </div>
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            {(issue.status === "open" || issue.status === "queued") && issue.projectId && (
              <Button
                size="sm"
                variant="outline"
                className="h-5 text-[10px] px-1.5 border-emerald-800/40 text-emerald-400 hover:bg-emerald-900/20 hover:text-emerald-300"
                onClick={() => onDispatch(issue.id)}
              >
                <Zap className="h-2.5 w-2.5 mr-0.5" />
                Dispatch
              </Button>
            )}
            {issue.status === "open" && !issue.projectId && (
              <Button size="sm" variant="outline" className="h-5 text-[10px] px-1.5 border-zinc-700/40 text-zinc-400 hover:text-zinc-300" onClick={() => onTransition(issue.id, "queued")}>
                Queue
              </Button>
            )}
            {issue.status === "review" && (
              <Button size="sm" variant="outline" className="h-5 text-[10px] px-1.5 border-zinc-700/40 text-zinc-400 hover:text-zinc-300" onClick={() => onTransition(issue.id, "done")}>
                Done
              </Button>
            )}
            {issue.status !== "done" && issue.status !== "cancelled" && (
              <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5 text-red-500/70 hover:text-red-400" onClick={() => onTransition(issue.id, "cancelled")}>
                <XCircle className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
