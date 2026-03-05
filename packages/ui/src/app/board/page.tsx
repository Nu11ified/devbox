"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PlusCircle } from "lucide-react";
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

const columns: { label: string; status: string }[] = [
  { label: "Open", status: "open" },
  { label: "Queued", status: "queued" },
  { label: "In Progress", status: "in_progress" },
  { label: "Review", status: "review" },
  { label: "Done", status: "done" },
];

const priorityLabels: Record<number, string> = {
  0: "Urgent",
  1: "High",
  2: "Medium",
  3: "Low",
};

const priorityVariants: Record<number, "destructive" | "default" | "secondary" | "outline"> = {
  0: "destructive",
  1: "default",
  2: "secondary",
  3: "outline",
};

export default function BoardPage() {
  const { data: issues, loading, error, refetch } = useApi(
    () => api.listIssues(),
    []
  );

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
        <h1 className="text-2xl font-bold">Board</h1>
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

      {loading && !issues && (
        <div className="py-12 text-center text-muted-foreground">
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
          return (
            <div key={col.status} className="flex-shrink-0 w-72">
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-sm font-semibold">{col.label}</h2>
                <Badge variant="secondary" className="text-xs">
                  {colIssues.length}
                </Badge>
              </div>
              <ScrollArea className="h-[calc(100vh-12rem)]">
                <div className="space-y-2 pr-2">
                  {colIssues.map((issue) => (
                    <Card key={issue.id} className="shadow-sm">
                      <CardHeader className="p-3 pb-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs text-muted-foreground">{issue.identifier}</p>
                            <CardTitle className="text-sm leading-tight">
                              <Link
                                href={`/board/${issue.id}`}
                                className="hover:underline"
                              >
                                {issue.title}
                              </Link>
                            </CardTitle>
                          </div>
                          <Badge variant={priorityVariants[issue.priority] ?? "outline"} className="shrink-0 text-xs">
                            {priorityLabels[issue.priority] ?? "Low"}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="p-3 pt-1">
                        <p className="text-xs text-muted-foreground truncate">{issue.repo}</p>
                        <div className="flex gap-1 mt-2">
                          {issue.status === "open" && (
                            <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => transition(issue.id, "queued")}>
                              Queue
                            </Button>
                          )}
                          {issue.status === "review" && (
                            <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => transition(issue.id, "done")}>
                              Done
                            </Button>
                          )}
                          {issue.status !== "done" && issue.status !== "cancelled" && (
                            <Button size="sm" variant="ghost" className="h-6 text-xs text-destructive" onClick={() => transition(issue.id, "cancelled")}>
                              Cancel
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
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
