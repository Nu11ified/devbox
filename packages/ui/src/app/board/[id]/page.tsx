"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

  if (loading) {
    return (
      <div className="p-4 md:p-6">
        <div className="py-12 text-center text-muted-foreground">Loading issue...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 md:p-6">
        <div className="py-12 text-center text-destructive">
          Failed to load issue: {error.message}
        </div>
      </div>
    );
  }

  if (!issue) return null;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link href="/board">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Board
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">{issue.identifier}</p>
              <CardTitle className="text-xl">{issue.title}</CardTitle>
            </div>
            <Badge variant={priorityVariants[issue.priority] ?? "outline"}>
              {priorityLabels[issue.priority] ?? "Low"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {issue.body && (
            <div>
              <h3 className="text-sm font-semibold mb-1">Description</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{issue.body}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="font-semibold">Status</span>
              <p className="text-muted-foreground">{issue.status}</p>
            </div>
            <div>
              <span className="font-semibold">Repo</span>
              <p className="text-muted-foreground">{issue.repo}</p>
            </div>
            <div>
              <span className="font-semibold">Branch</span>
              <p className="text-muted-foreground">{issue.branch || "—"}</p>
            </div>
            <div>
              <span className="font-semibold">Assignee</span>
              <p className="text-muted-foreground">{issue.assignee || "Unassigned"}</p>
            </div>
          </div>

          {issue.labels && issue.labels.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-1">Labels</h3>
              <div className="flex gap-1 flex-wrap">
                {issue.labels.map((label) => (
                  <Badge key={label} variant="secondary">{label}</Badge>
                ))}
              </div>
            </div>
          )}

          {issue.last_error && (
            <div>
              <h3 className="text-sm font-semibold mb-1">Last Error</h3>
              <p className="text-sm text-destructive">{issue.last_error}</p>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            {issue.status === "open" && (
              <Button size="sm" variant="outline" onClick={() => transition("queued")}>
                Queue
              </Button>
            )}
            {issue.status === "review" && (
              <Button size="sm" variant="outline" onClick={() => transition("done")}>
                Done
              </Button>
            )}
            {issue.status !== "done" && issue.status !== "cancelled" && (
              <Button size="sm" variant="ghost" className="text-destructive" onClick={() => transition("cancelled")}>
                Cancel
              </Button>
            )}
            {issue.run_id && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/runs/${issue.run_id}`}>View Run</Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
