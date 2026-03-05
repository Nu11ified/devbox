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
import { Github, Loader2, CheckCircle2, Star, GitFork, Lock, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

interface GitHubRepo {
  full_name: string;
  name: string;
  owner: { login: string };
  description: string | null;
  stargazers_count?: number;
  forks_count?: number;
  private?: boolean;
  language?: string;
}

interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  html_url: string;
  labels: Array<{ name: string; color?: string }>;
  created_at?: string;
  user?: { login: string; avatar_url: string };
}

export function GitHubImportDialog({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [issues, setIssues] = useState<GitHubIssue[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setLoading(true);
      setImportResult(null);
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
    setImportResult(null);

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

  function toggleAll() {
    if (selected.size === issues.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(issues.map((i) => i.number)));
    }
  }

  async function handleImport() {
    const [owner, repo] = selectedRepo.split("/");
    if (!owner || !repo || selected.size === 0) return;

    setImporting(true);
    try {
      const result = await api.importGitHubIssues(owner, repo, Array.from(selected));
      setImportResult({ imported: result.imported.length, skipped: result.skipped.length });
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
      <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            Import GitHub Issues
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 flex-1 overflow-hidden flex flex-col">
          {error && (
            <div className="text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          {importResult && (
            <div className="text-sm bg-green-500/5 border border-green-500/20 rounded-md px-3 py-2 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
              <span>
                Imported {importResult.imported} issue{importResult.imported !== 1 ? "s" : ""}
                {importResult.skipped > 0 && `, ${importResult.skipped} already existed`}
              </span>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/70">Repository</Label>
            <Select value={selectedRepo} onValueChange={handleRepoChange}>
              <SelectTrigger>
                <SelectValue placeholder={loading && !selectedRepo ? "Loading repos..." : "Select a repository"} />
              </SelectTrigger>
              <SelectContent>
                {repos.map((r) => (
                  <SelectItem key={r.full_name} value={r.full_name}>
                    <div className="flex items-center gap-2">
                      {r.private ? (
                        <Lock className="h-3 w-3 text-muted-foreground/50" />
                      ) : (
                        <Globe className="h-3 w-3 text-muted-foreground/50" />
                      )}
                      <span className="font-mono text-sm">{r.full_name}</span>
                      {r.stargazers_count !== undefined && r.stargazers_count > 0 && (
                        <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/50 ml-auto">
                          <Star className="h-2.5 w-2.5" /> {r.stargazers_count}
                        </span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {loading && selectedRepo && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}

          {issues.length > 0 && (
            <div className="space-y-2 flex-1 overflow-hidden flex flex-col">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/70">
                  Issues ({issues.length} open)
                </Label>
                <button
                  onClick={toggleAll}
                  className="text-[10px] font-mono text-primary hover:underline"
                >
                  {selected.size === issues.length ? "Deselect all" : "Select all"}
                </button>
              </div>
              <div className="border rounded-md overflow-y-auto flex-1">
                {issues.map((issue) => (
                  <label
                    key={issue.number}
                    className={cn(
                      "flex items-start gap-3 px-3 py-2.5 border-b last:border-b-0 cursor-pointer transition-colors",
                      selected.has(issue.number)
                        ? "bg-primary/5"
                        : "hover:bg-muted/30"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(issue.number)}
                      onChange={() => toggleIssue(issue.number)}
                      className="mt-0.5 rounded"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <p className="text-sm font-medium leading-tight flex-1">
                          {issue.title}
                        </p>
                        <span className="text-[10px] font-mono text-muted-foreground/40 shrink-0">
                          #{issue.number}
                        </span>
                      </div>
                      {issue.labels.length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {issue.labels.map((l) => (
                            <span
                              key={l.name}
                              className="text-[9px] font-mono px-1.5 py-0.5 rounded-full shrink-0"
                              style={l.color ? {
                                backgroundColor: `#${l.color}18`,
                                color: `#${l.color}`,
                              } : undefined}
                            >
                              {l.name}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        {issue.user && (
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
                            <img
                              src={issue.user.avatar_url}
                              alt=""
                              className="w-3 h-3 rounded-full"
                            />
                            <span className="font-mono">{issue.user.login}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {selectedRepo && issues.length === 0 && !loading && (
            <div className="py-8 text-center text-sm text-muted-foreground/60">
              No open issues in this repository.
            </div>
          )}

          <Button
            onClick={handleImport}
            disabled={selected.size === 0 || importing}
            className="w-full"
          >
            {importing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Importing...
              </>
            ) : (
              `Import ${selected.size} issue${selected.size !== 1 ? "s" : ""}`
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
