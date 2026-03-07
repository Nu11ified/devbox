"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Loader2, Star, Lock, Globe, Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface GitHubRepo {
  full_name: string;
  name: string;
  description: string | null;
  stargazers_count?: number;
  private?: boolean;
  language?: string;
}

const languageColors: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  Go: "#00ADD8",
  Rust: "#dea584",
  Java: "#b07219",
  Ruby: "#701516",
  "C++": "#f34b7d",
  C: "#555555",
  Swift: "#F05138",
  Kotlin: "#A97BFF",
  PHP: "#4F5D95",
};

export default function OnboardingPage() {
  const router = useRouter();
  const { data: session } = useSession();

  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [claudeSub, setClaudeSub] = useState(false);
  const [openaiSub, setOpenaiSub] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const user = session?.user;

  useEffect(() => {
    api.listGitHubRepos()
      .then(setRepos)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function toggleRepo(fullName: string) {
    setSelectedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(fullName)) next.delete(fullName);
      else next.add(fullName);
      return next;
    });
  }

  function toggleAll() {
    if (selectedRepos.size === repos.length) {
      setSelectedRepos(new Set());
    } else {
      setSelectedRepos(new Set(repos.map((r) => r.full_name)));
    }
  }

  async function handleSubmit() {
    setSaving(true);
    setError("");
    try {
      await api.updateSettings({
        selectedRepos: Array.from(selectedRepos),
        claudeSubscription: claudeSub,
        openaiSubscription: openaiSub,
        onboardingCompleted: true,
      });
      router.push("/board");
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center pb-2">
          {/* User avatar */}
          {user?.image && (
            <div className="flex justify-center mb-3">
              <img
                src={user.image}
                alt=""
                className="w-16 h-16 rounded-full border-2 border-border/40 shadow-sm"
              />
            </div>
          )}
          <CardTitle className="text-2xl font-bold tracking-tight">
            Welcome to Patchwork
          </CardTitle>
          <CardDescription className="text-sm">
            {user?.name
              ? <>Hey <span className="font-medium text-foreground">{user.name}</span>! Let&apos;s set up your workspace.</>
              : "Let's set up your workspace."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <div className="text-sm text-destructive bg-destructive/5 border border-destructive/20 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          {/* Repo selection */}
          <div className="space-y-2">
            <Label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/70">
              Repositories to monitor
            </Label>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground/60">
                Issues labeled <code className="text-[10px] px-1 py-0.5 bg-muted rounded font-mono">patchwork</code> in these repos will auto-sync to your board.
              </p>
              {repos.length > 0 && (
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-[11px] font-mono text-primary hover:text-primary/80 transition-colors shrink-0 ml-2"
                >
                  {selectedRepos.size === repos.length ? "Deselect all" : "Select all"}
                </button>
              )}
            </div>
            <div className="border rounded-md max-h-64 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : repos.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground/60 text-center">
                  No repositories found.
                </p>
              ) : (
                repos.map((repo) => (
                  <div
                    key={repo.full_name}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleRepo(repo.full_name)}
                    onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggleRepo(repo.full_name); } }}
                    className={cn(
                      "flex items-start gap-3 px-3 py-2.5 border-b last:border-b-0 cursor-pointer transition-colors select-none",
                      selectedRepos.has(repo.full_name) ? "bg-primary/5" : "hover:bg-muted/30"
                    )}
                  >
                    <div className="mt-0.5 w-4 h-4 rounded border border-border/60 flex items-center justify-center shrink-0">
                      {selectedRepos.has(repo.full_name) && (
                        <Check className="h-3 w-3 text-primary" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {repo.private ? (
                          <Lock className="h-3 w-3 text-muted-foreground/40" />
                        ) : (
                          <Globe className="h-3 w-3 text-muted-foreground/40" />
                        )}
                        <span className="text-sm font-medium font-mono">{repo.full_name}</span>
                      </div>
                      {repo.description && (
                        <p className="text-xs text-muted-foreground/60 truncate mt-0.5">
                          {repo.description}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-1">
                        {repo.language && (
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground/50">
                            <span
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: languageColors[repo.language] || "#8b8b8b" }}
                            />
                            {repo.language}
                          </span>
                        )}
                        {repo.stargazers_count !== undefined && repo.stargazers_count > 0 && (
                          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/50">
                            <Star className="h-2.5 w-2.5" /> {repo.stargazers_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            {selectedRepos.size > 0 && (
              <p className="text-[10px] font-mono text-muted-foreground/50">
                {selectedRepos.size} repo{selectedRepos.size !== 1 ? "s" : ""} selected
              </p>
            )}
          </div>

          {/* Subscriptions */}
          <div className="space-y-3">
            <Label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground/70">
              Agent Subscriptions
            </Label>
            <p className="text-xs text-muted-foreground/60">
              Use your own subscriptions instead of API keys.
            </p>
            <label className={cn(
              "flex items-center gap-3 cursor-pointer p-3 rounded-md border transition-colors",
              claudeSub ? "border-primary/30 bg-primary/5" : "border-border/40 hover:bg-muted/30"
            )}>
              <div className="w-4 h-4 rounded border border-border/60 flex items-center justify-center shrink-0">
                {claudeSub && <Check className="h-3 w-3 text-primary" />}
              </div>
              <input
                type="checkbox"
                checked={claudeSub}
                onChange={(e) => setClaudeSub(e.target.checked)}
                className="sr-only"
              />
              <div className="flex-1">
                <p className="text-sm font-medium">Claude subscription</p>
                <p className="text-[11px] text-muted-foreground/60">
                  Uses <code className="text-[10px] px-1 py-0.5 bg-muted rounded font-mono">--subscription</code> flag
                </p>
              </div>
              <Sparkles className="h-4 w-4 text-muted-foreground/30" />
            </label>
            <label className={cn(
              "flex items-center gap-3 cursor-pointer p-3 rounded-md border transition-colors",
              openaiSub ? "border-primary/30 bg-primary/5" : "border-border/40 hover:bg-muted/30"
            )}>
              <div className="w-4 h-4 rounded border border-border/60 flex items-center justify-center shrink-0">
                {openaiSub && <Check className="h-3 w-3 text-primary" />}
              </div>
              <input
                type="checkbox"
                checked={openaiSub}
                onChange={(e) => setOpenaiSub(e.target.checked)}
                className="sr-only"
              />
              <div className="flex-1">
                <p className="text-sm font-medium">OpenAI subscription</p>
                <p className="text-[11px] text-muted-foreground/60">
                  Uses your OpenAI subscription
                </p>
              </div>
            </label>
          </div>

          <Button
            onClick={handleSubmit}
            disabled={saving}
            className="w-full"
            size="lg"
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Setting up...
              </>
            ) : (
              "Get Started"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
