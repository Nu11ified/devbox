"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, GitBranch } from "lucide-react";

export default function NewThreadPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [provider, setProvider] = useState("claudeCode");
  const [model, setModel] = useState("");
  const [runtimeMode, setRuntimeMode] = useState("approval-required");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [repos, setRepos] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [loadingDefaults, setLoadingDefaults] = useState(true);

  useEffect(() => {
    api.getSettings()
      .then((settings: any) => {
        if (settings.defaultProvider) setProvider(settings.defaultProvider);
        if (settings.defaultModel) setModel(settings.defaultModel);
        if (settings.defaultRuntimeMode) setRuntimeMode(settings.defaultRuntimeMode);
      })
      .catch(() => {})
      .finally(() => setLoadingDefaults(false));

    api.listGitHubRepos()
      .then((r: any[]) => setRepos(r))
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    setCreating(true);
    setError("");
    try {
      const result = await api.createThread({
        title: title.trim(),
        provider,
        model: model || undefined,
        runtimeMode,
        workspacePath: "/workspace",
        repo: repo || undefined,
        branch: repo ? branch : undefined,
      });
      router.push(`/threads/${result.id}`);
    } catch (err: any) {
      setError(err.message || "Failed to create thread");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl font-bold tracking-tight">
            New Thread
          </CardTitle>
          <CardDescription className="text-sm">
            Start a new agent conversation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="title" className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/70">
                Title
              </Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What should the agent work on?"
                required
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/70">
                Repository
              </Label>
              <Select value={repo || "none"} onValueChange={(v) => setRepo(v === "none" ? "" : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="No repo (local workspace)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (local workspace)</SelectItem>
                  {repos.map((r: any) => (
                    <SelectItem key={r.full_name} value={r.full_name}>
                      {r.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground/50">
                Select a GitHub repo to clone into a devbox.
              </p>
            </div>

            {repo && (
              <div className="space-y-2">
                <Label htmlFor="branch" className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/70">
                  Branch
                </Label>
                <Input
                  id="branch"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="main"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/70">
                Provider
              </Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claudeCode">Claude Code</SelectItem>
                  <SelectItem value="codex">Codex</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="model" className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/70">
                Model
              </Label>
              <Input
                id="model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="claude-sonnet-4-6"
              />
              <p className="text-[10px] text-muted-foreground/50">
                Leave empty for default model.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/70">
                Runtime Mode
              </Label>
              <Select value={runtimeMode} onValueChange={setRuntimeMode}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="approval-required">Approval Required</SelectItem>
                  <SelectItem value="full-access">Full Access</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground/50">
                Full access bypasses permission prompts for all tools.
              </p>
            </div>

            <Button
              type="submit"
              disabled={creating || !title.trim()}
              className="w-full"
              size="lg"
            >
              {creating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Thread"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
