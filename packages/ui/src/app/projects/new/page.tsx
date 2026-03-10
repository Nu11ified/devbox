"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Loader2, GitBranch } from "lucide-react";

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [repos, setRepos] = useState<any[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .listGitHubRepos()
      .then((r: any[]) => setRepos(r))
      .catch(() => {})
      .finally(() => setLoadingRepos(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !repo) return;

    setCreating(true);
    setError("");
    try {
      const result = await api.createProject({
        name: name.trim(),
        repo,
        branch: branch || "main",
      });
      router.push(`/projects/${result.id}`);
    } catch (err: any) {
      setError(err.message || "Failed to create project");
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
              New Project
            </h1>
            <p className="text-sm text-zinc-400 mt-1">
              Connect a repository and start building.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="px-6 pb-6 pt-4 space-y-5">
            {error && (
              <div className="text-sm text-red-400 bg-red-500/5 border border-red-500/20 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            {/* Name */}
            <div className="space-y-2">
              <label
                htmlFor="name"
                className="text-[11px] font-mono uppercase tracking-wider text-zinc-500"
              >
                Name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My App"
                required
                autoFocus
                className="w-full bg-zinc-900 border border-zinc-700/50 focus:border-zinc-600 text-zinc-100 rounded-lg px-3 py-2 text-sm outline-none transition-colors placeholder:text-zinc-600"
              />
            </div>

            {/* Repository */}
            <div className="space-y-2">
              <label
                htmlFor="repo"
                className="text-[11px] font-mono uppercase tracking-wider text-zinc-500"
              >
                Repository
              </label>
              <select
                id="repo"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700/50 focus:border-zinc-600 text-zinc-100 rounded-lg px-3 py-2 text-sm outline-none transition-colors appearance-none cursor-pointer"
              >
                <option value="" className="text-zinc-600">
                  {loadingRepos ? "Loading repositories..." : "Select a repository"}
                </option>
                {repos.map((r: any) => (
                  <option key={r.full_name} value={r.full_name}>
                    {r.full_name}
                  </option>
                ))}
              </select>
              {loadingRepos && (
                <div className="flex items-center gap-2 text-[10px] text-zinc-600">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Fetching repositories from GitHub...
                </div>
              )}
            </div>

            {/* Branch */}
            <div className="space-y-2">
              <label
                htmlFor="branch"
                className="text-[11px] font-mono uppercase tracking-wider text-zinc-500"
              >
                Branch
              </label>
              <div className="relative">
                <GitBranch className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-600" />
                <input
                  id="branch"
                  type="text"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  placeholder="main"
                  className="w-full bg-zinc-900 border border-zinc-700/50 focus:border-zinc-600 text-zinc-100 rounded-lg pl-9 pr-3 py-2 text-sm outline-none transition-colors placeholder:text-zinc-600"
                />
              </div>
              <p className="text-[10px] text-zinc-600">
                Default branch for the project.
              </p>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={creating || !name.trim() || !repo}
              className="w-full bg-zinc-100 text-zinc-900 hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Project"
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
