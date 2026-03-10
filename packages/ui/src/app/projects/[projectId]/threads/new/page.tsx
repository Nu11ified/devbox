"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, type ProjectDetail } from "@/lib/api";
import { Loader2, GitBranch, FolderRoot, GitFork } from "lucide-react";

function shortId() {
  return Math.random().toString(36).slice(2, 8);
}

export default function NewProjectThreadPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loadingProject, setLoadingProject] = useState(true);

  const [title, setTitle] = useState("");
  const [provider, setProvider] = useState("claudeCode");
  const [model, setModel] = useState("");
  const [runtimeMode, setRuntimeMode] = useState("approval-required");
  const [environment, setEnvironment] = useState<"local" | "worktree">("local");
  const [worktreeBranch, setWorktreeBranch] = useState(`thread/${shortId()}`);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .getProject(projectId)
      .then((data) => setProject(data))
      .catch(() => {})
      .finally(() => setLoadingProject(false));

    api
      .getSettings()
      .then((settings: any) => {
        if (settings.defaultProvider) setProvider(settings.defaultProvider);
        if (settings.defaultModel) setModel(settings.defaultModel);
        if (settings.defaultRuntimeMode) setRuntimeMode(settings.defaultRuntimeMode);
      })
      .catch(() => {});
  }, [projectId]);

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
        projectId,
        worktreeBranch: environment === "worktree" ? worktreeBranch : undefined,
      });
      router.push(`/projects/${projectId}/threads/${result.id}`);
    } catch (err: any) {
      setError(err.message || "Failed to create thread");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl overflow-hidden">
          {/* Header */}
          <div className="px-6 pt-6 pb-2">
            <h1 className="text-xl font-bold tracking-tight text-zinc-100">
              New Thread
            </h1>
            <p className="text-sm text-zinc-400 mt-1">
              {loadingProject ? (
                "Loading project..."
              ) : project ? (
                <>
                  Start a new agent session in{" "}
                  <span className="font-mono text-zinc-300">{project.name}</span>
                </>
              ) : (
                "Start a new agent session."
              )}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="px-6 pb-6 pt-4 space-y-5">
            {error && (
              <div className="text-sm text-red-400 bg-red-500/5 border border-red-500/20 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            {/* Title */}
            <div className="space-y-2">
              <label
                htmlFor="title"
                className="text-[11px] font-mono uppercase tracking-wider text-zinc-500"
              >
                Title
              </label>
              <input
                id="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What should the agent work on?"
                required
                autoFocus
                className="w-full bg-zinc-900 border border-zinc-700/50 focus:border-zinc-600 text-zinc-100 rounded-lg px-3 py-2 text-sm outline-none transition-colors placeholder:text-zinc-600"
              />
            </div>

            {/* Environment */}
            <div className="space-y-2">
              <label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
                Environment
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setEnvironment("local")}
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-all ${
                    environment === "local"
                      ? "border-zinc-600 bg-zinc-800/60 text-zinc-100"
                      : "border-zinc-700/40 bg-zinc-900/50 text-zinc-500 hover:border-zinc-700/60 hover:text-zinc-400"
                  }`}
                >
                  <FolderRoot className="h-4 w-4 shrink-0" />
                  <div className="text-left">
                    <div className="font-medium text-sm">Local</div>
                    <div className="text-[10px] text-zinc-500">Project root</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setEnvironment("worktree")}
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-all ${
                    environment === "worktree"
                      ? "border-zinc-600 bg-zinc-800/60 text-zinc-100"
                      : "border-zinc-700/40 bg-zinc-900/50 text-zinc-500 hover:border-zinc-700/60 hover:text-zinc-400"
                  }`}
                >
                  <GitFork className="h-4 w-4 shrink-0" />
                  <div className="text-left">
                    <div className="font-medium text-sm">Worktree</div>
                    <div className="text-[10px] text-zinc-500">Isolated branch</div>
                  </div>
                </button>
              </div>
            </div>

            {/* Worktree branch name */}
            {environment === "worktree" && (
              <div className="space-y-2">
                <label
                  htmlFor="worktree-branch"
                  className="text-[11px] font-mono uppercase tracking-wider text-zinc-500"
                >
                  Worktree Branch
                </label>
                <div className="relative">
                  <GitBranch className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-600" />
                  <input
                    id="worktree-branch"
                    type="text"
                    value={worktreeBranch}
                    onChange={(e) => setWorktreeBranch(e.target.value)}
                    placeholder="thread/abc123"
                    className="w-full bg-zinc-900 border border-zinc-700/50 focus:border-zinc-600 text-zinc-100 rounded-lg pl-9 pr-3 py-2 text-sm font-mono outline-none transition-colors placeholder:text-zinc-600"
                  />
                </div>
                <p className="text-[10px] text-zinc-600">
                  Creates a git worktree with an isolated copy of the repo.
                </p>
              </div>
            )}

            {/* Provider */}
            <div className="space-y-2">
              <label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
                Provider
              </label>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700/50 focus:border-zinc-600 text-zinc-100 rounded-lg px-3 py-2 text-sm outline-none transition-colors appearance-none cursor-pointer"
              >
                <option value="claudeCode">Claude Code</option>
                <option value="codex">Codex</option>
              </select>
            </div>

            {/* Model */}
            <div className="space-y-2">
              <label
                htmlFor="model"
                className="text-[11px] font-mono uppercase tracking-wider text-zinc-500"
              >
                Model
              </label>
              <input
                id="model"
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="claude-opus-4-6"
                className="w-full bg-zinc-900 border border-zinc-700/50 focus:border-zinc-600 text-zinc-100 rounded-lg px-3 py-2 text-sm outline-none transition-colors placeholder:text-zinc-600"
              />
              <p className="text-[10px] text-zinc-600">
                Leave empty for default model.
              </p>
            </div>

            {/* Runtime Mode */}
            <div className="space-y-2">
              <label className="text-[11px] font-mono uppercase tracking-wider text-zinc-500">
                Runtime Mode
              </label>
              <select
                value={runtimeMode}
                onChange={(e) => setRuntimeMode(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700/50 focus:border-zinc-600 text-zinc-100 rounded-lg px-3 py-2 text-sm outline-none transition-colors appearance-none cursor-pointer"
              >
                <option value="approval-required">Approval Required</option>
                <option value="full-access">Full Access</option>
              </select>
              <p className="text-[10px] text-zinc-600">
                Full access bypasses permission prompts for all tools.
              </p>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={creating || !title.trim()}
              className="w-full bg-zinc-100 text-zinc-900 hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Thread"
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
