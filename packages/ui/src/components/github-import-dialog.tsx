"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Github } from "lucide-react";

interface GitHubRepo {
  full_name: string;
  name: string;
  owner: { login: string };
  description: string | null;
}

interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  html_url: string;
  labels: Array<{ name: string }>;
}

export function GitHubImportDialog({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setLoading(true);
      api.listGitHubRepos()
        .then(setRepos)
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [open]);

  async function handleRepoChange(repoFullName: string) {
    setSelectedRepo(repoFullName);
    setSelected(new Set());
    setIssues([]);
    setError("");

    const [owner, repo] = repoFullName.split("/");
    if (!owner || !repo) return;

    setLoading(true);
    try {
      const data = await api.listGitHubIssues(owner, repo);
      setIssues(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function toggleIssue(num: number) {
    const next = new Set(selected);
    if (next.has(num)) next.delete(num);
    else next.add(num);
    setSelected(next);
  }

  async function handleImport() {
    const [owner, repo] = selectedRepo.split("/");
    if (!owner || !repo || selected.size === 0) return;

    setImporting(true);
    try {
      await api.importGitHubIssues(owner, repo, Array.from(selected));
      setOpen(false);
      setSelectedRepo("");
      setIssues([]);
      setSelected(new Set());
      onImported();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Github className="mr-2 h-4 w-4" />
          Import from GitHub
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import GitHub Issues</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="space-y-2">
            <Label>Repository</Label>
            <Select value={selectedRepo} onValueChange={handleRepoChange}>
              <SelectTrigger>
                <SelectValue placeholder={loading ? "Loading repos..." : "Select a repository"} />
              </SelectTrigger>
              <SelectContent>
                {repos.map((r) => (
                  <SelectItem key={r.full_name} value={r.full_name}>
                    {r.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {issues.length > 0 && (
            <div className="space-y-2">
              <Label>Issues ({issues.length} open)</Label>
              <div className="border rounded-md max-h-60 overflow-y-auto">
                {issues.map((issue) => (
                  <label
                    key={issue.number}
                    className="flex items-start gap-3 p-3 border-b last:border-b-0 hover:bg-muted/50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(issue.number)}
                      onChange={() => toggleIssue(issue.number)}
                      className="mt-1"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        #{issue.number} {issue.title}
                      </p>
                      {issue.labels.length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {issue.labels.map((l) => (
                            <span
                              key={l.name}
                              className="text-xs bg-muted px-1.5 py-0.5 rounded"
                            >
                              {l.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {selectedRepo && issues.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground">No open issues in this repository.</p>
          )}

          <Button
            onClick={handleImport}
            disabled={selected.size === 0 || importing}
            className="w-full"
          >
            {importing
              ? "Importing..."
              : `Import ${selected.size} issue${selected.size !== 1 ? "s" : ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
