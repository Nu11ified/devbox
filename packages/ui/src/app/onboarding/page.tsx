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

interface GitHubRepo {
  full_name: string;
  name: string;
  description: string | null;
}

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

  useEffect(() => {
    api.listGitHubRepos()
      .then(setRepos)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function toggleRepo(fullName: string) {
    const next = new Set(selectedRepos);
    if (next.has(fullName)) next.delete(fullName);
    else next.add(fullName);
    setSelectedRepos(next);
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
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Welcome to Patchwork</CardTitle>
          <CardDescription>
            {session?.user?.name
              ? `Hey ${session.user.name}! Let's set up your workspace.`
              : "Let's set up your workspace."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* Repo selection */}
          <div className="space-y-2">
            <Label>Select repositories to monitor</Label>
            <p className="text-xs text-muted-foreground">
              Issues labeled &quot;patchwork&quot; in these repos will auto-sync to your board.
            </p>
            <div className="border rounded-md max-h-48 overflow-y-auto">
              {loading ? (
                <p className="p-3 text-sm text-muted-foreground">Loading repositories...</p>
              ) : repos.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No repositories found.</p>
              ) : (
                repos.map((repo) => (
                  <label
                    key={repo.full_name}
                    className="flex items-start gap-3 p-3 border-b last:border-b-0 hover:bg-muted/50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedRepos.has(repo.full_name)}
                      onChange={() => toggleRepo(repo.full_name)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{repo.full_name}</p>
                      {repo.description && (
                        <p className="text-xs text-muted-foreground truncate">
                          {repo.description}
                        </p>
                      )}
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* Subscriptions */}
          <div className="space-y-3">
            <Label>Agent Subscriptions</Label>
            <p className="text-xs text-muted-foreground">
              Use your own subscriptions instead of API keys.
            </p>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={claudeSub}
                onChange={(e) => setClaudeSub(e.target.checked)}
              />
              <div>
                <p className="text-sm font-medium">Claude subscription</p>
                <p className="text-xs text-muted-foreground">
                  Uses --subscription flag (no API key needed)
                </p>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={openaiSub}
                onChange={(e) => setOpenaiSub(e.target.checked)}
              />
              <div>
                <p className="text-sm font-medium">OpenAI subscription</p>
                <p className="text-xs text-muted-foreground">
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
            {saving ? "Setting up..." : "Get Started"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
