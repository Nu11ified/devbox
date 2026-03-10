"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, type ProjectDetail } from "@/lib/api";
import { Plus, GitBranch, MessageSquare } from "lucide-react";

export default function ProjectOverviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .getProject(projectId)
      .then((data) => setProject(data))
      .catch((err) => console.error("Failed to load project:", err))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-zinc-500">Project not found.</p>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center max-w-md mx-auto px-6">
        {/* Project info */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-zinc-100">
            {project.name}
          </h2>
          <div className="flex items-center justify-center gap-2 mt-2">
            <span className="text-[11px] font-mono text-zinc-500">
              {project.repo}
            </span>
            <span className="text-zinc-700">|</span>
            <span className="flex items-center gap-1 text-[11px] font-mono text-zinc-500">
              <GitBranch className="h-3 w-3" />
              {project.branch}
            </span>
          </div>
        </div>

        {/* Empty state */}
        <div className="mb-8">
          <div className="w-12 h-12 rounded-xl bg-zinc-800/50 border border-zinc-700/40 flex items-center justify-center mx-auto mb-4">
            <MessageSquare className="h-5 w-5 text-zinc-500" />
          </div>
          <p className="text-sm text-zinc-400 mb-1">
            Select a thread from the sidebar or create a new one.
          </p>
          <p className="text-xs text-zinc-600">
            Each thread runs an independent agent session.
          </p>
        </div>

        {/* Quick actions */}
        <button
          onClick={() => router.push(`/projects/${projectId}/threads/new`)}
          className="inline-flex items-center gap-2 bg-zinc-100 text-zinc-900 hover:bg-zinc-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Thread
        </button>
      </div>
    </div>
  );
}
