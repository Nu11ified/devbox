"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type ProjectItem } from "@/lib/api";
import { Plus, GitBranch, MessageSquare, CircleDot } from "lucide-react";
import { cn } from "@/lib/utils";

const statusDot: Record<string, string> = {
  active: "bg-emerald-400 animate-pulse",
  idle: "bg-zinc-600",
  error: "bg-red-400",
};

const statusLabel: Record<string, string> = {
  active: "Active",
  idle: "Idle",
  error: "Error",
};

function SkeletonCard() {
  return (
    <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-5 animate-pulse">
      <div className="flex items-start justify-between mb-4">
        <div className="space-y-2 flex-1">
          <div className="h-4 w-32 bg-zinc-800/60 rounded" />
          <div className="h-3 w-24 bg-zinc-800/40 rounded" />
        </div>
        <div className="h-5 w-14 bg-zinc-800/40 rounded-full" />
      </div>
      <div className="flex items-center gap-4 mt-4">
        <div className="h-3 w-16 bg-zinc-800/40 rounded" />
        <div className="h-3 w-16 bg-zinc-800/40 rounded" />
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listProjects()
      .then((data) => setProjects(data))
      .catch((err) => console.error("Failed to load projects:", err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
              Projects
            </h1>
            <p className="text-sm text-zinc-400 mt-1">
              Manage your repositories and agent threads.
            </p>
          </div>
          <button
            onClick={() => router.push("/projects/new")}
            className="flex items-center gap-2 bg-zinc-100 text-zinc-900 hover:bg-zinc-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Project
          </button>
        </div>

        {/* Loading skeletons */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {/* Empty state */}
        {!loading && projects.length === 0 && (
          <div className="text-center py-20">
            <div className="w-12 h-12 rounded-xl bg-zinc-800/50 border border-zinc-700/40 flex items-center justify-center mx-auto mb-4">
              <GitBranch className="h-5 w-5 text-zinc-500" />
            </div>
            <p className="text-sm text-zinc-400 mb-1">No projects yet.</p>
            <p className="text-xs text-zinc-600">
              Create one to get started.
            </p>
          </div>
        )}

        {/* Project grid */}
        {!loading && projects.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => router.push(`/projects/${project.id}`)}
                className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-5 text-left hover:border-zinc-700/60 transition-all group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-medium text-zinc-100 truncate group-hover:text-white transition-colors">
                      {project.name}
                    </h3>
                    <p className="text-[11px] font-mono text-zinc-500 truncate mt-0.5">
                      {project.repo}
                    </p>
                  </div>
                  <span className="flex items-center gap-1.5 text-[10px] text-zinc-500 bg-zinc-800/50 px-2 py-0.5 rounded-full shrink-0 ml-2">
                    <GitBranch className="h-2.5 w-2.5" />
                    {project.branch}
                  </span>
                </div>

                <div className="flex items-center gap-4 mt-4">
                  <div className="flex items-center gap-1.5">
                    <MessageSquare className="h-3 w-3 text-zinc-600" />
                    <span className="text-[11px] text-zinc-500">
                      {project._count?.threads ?? 0} threads
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CircleDot className="h-3 w-3 text-zinc-600" />
                    <span className="text-[11px] text-zinc-500">
                      {project._count?.issues ?? 0} issues
                    </span>
                  </div>
                  <div className="flex-1" />
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        statusDot[project.status] || "bg-zinc-600",
                      )}
                    />
                    <span className="text-[10px] text-zinc-600">
                      {statusLabel[project.status] || project.status}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
