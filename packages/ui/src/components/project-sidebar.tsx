"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Plus, GitBranch, CircleDot, Archive } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, type ProjectDetail } from "@/lib/api";

// ── Helpers ────────────────────────────────────────────────────────

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

const threadStatusDot: Record<string, string> = {
  active: "bg-emerald-400 animate-pulse",
  starting: "bg-emerald-400 animate-pulse",
  idle: "bg-zinc-600",
  error: "bg-red-400",
};

const issueStatusColor: Record<string, string> = {
  open: "text-zinc-400",
  queued: "text-blue-400",
  in_progress: "text-amber-400",
  review: "text-violet-400",
  done: "text-emerald-400",
  cancelled: "text-red-400",
  archived: "text-zinc-600",
};

// ── Component ──────────────────────────────────────────────────────

export function ProjectSidebar({
  projectId,
  collapsed,
  onToggle,
}: {
  projectId: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveItems, setArchiveItems] = useState<Array<{
    id: string;
    identifier: string;
    title: string;
    archivedAt: string | null;
  }>>([]);
  const [archiveLoading, setArchiveLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    function fetchProject() {
      api
        .getProject(projectId)
        .then((data) => {
          if (!cancelled) {
            setProject(data);
            setLoading(false);
          }
        })
        .catch((err) => {
          console.error("Failed to fetch project:", err);
          if (!cancelled) setLoading(false);
        });
    }

    fetchProject();
    const interval = setInterval(fetchProject, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId]);

  useEffect(() => {
    if (!archiveOpen) return;
    let cancelled = false;
    setArchiveLoading(true);
    api.searchArchive({ projectId, limit: 10 })
      .then((res) => {
        if (!cancelled) {
          setArchiveItems(res.results.map((r) => ({
            id: r.id,
            identifier: r.identifier,
            title: r.title,
            archivedAt: r.archivedAt,
          })));
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setArchiveLoading(false); });
    return () => { cancelled = true; };
  }, [archiveOpen, projectId]);

  // Sort threads: active/starting first, then by updatedAt desc
  const sortedThreads = project?.threads
    ? [...project.threads].sort((a, b) => {
        const activeStatuses = ["active", "starting"];
        const aActive = activeStatuses.includes(a.status) ? 0 : 1;
        const bActive = activeStatuses.includes(b.status) ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      })
    : [];

  const projectStatusDot: Record<string, string> = {
    active: "bg-emerald-400",
    idle: "bg-zinc-600",
    error: "bg-red-400",
  };

  const projectStatusLabel: Record<string, string> = {
    active: "Active",
    idle: "Idle",
    error: "Error",
  };

  return (
    <div
      className={cn(
        "shrink-0 overflow-hidden transition-all duration-150 ease-out",
        collapsed ? "w-0" : "w-[260px]",
      )}
    >
      <div className="w-[260px] h-full flex flex-col bg-zinc-950/50 border-r border-zinc-800/40">
        {/* ── Header ──────────────────────────────────────── */}
        <div className="px-3 pt-3 pb-2 space-y-1.5">
          <Link
            href="/projects"
            className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            All Projects
          </Link>

          {loading ? (
            <div className="space-y-1.5">
              <div className="h-4 w-28 bg-zinc-800/30 rounded animate-pulse" />
              <div className="h-3 w-20 bg-zinc-800/30 rounded animate-pulse" />
            </div>
          ) : project ? (
            <>
              <div className="text-sm font-bold text-zinc-100 truncate">
                {project.name}
              </div>
              <div className="text-[10px] font-mono text-zinc-500 truncate">
                {project.repo}
              </div>
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    projectStatusDot[project.status] || "bg-zinc-600",
                  )}
                />
                <span className="text-[10px] text-zinc-500">
                  {projectStatusLabel[project.status] || project.status}
                </span>
              </div>
            </>
          ) : (
            <div className="text-xs text-zinc-600">Project not found</div>
          )}
        </div>

        {/* ── New Thread Button ────────────────────────────── */}
        <div className="px-3 py-2">
          <Link
            href={`/projects/${projectId}/threads/new`}
            className="flex items-center justify-between w-full bg-zinc-800/50 hover:bg-zinc-700/50 border border-zinc-700/40 rounded-lg px-3 py-2 text-sm text-zinc-300 transition-colors"
          >
            <span className="flex items-center gap-2">
              <Plus className="h-3.5 w-3.5" />
              New thread
            </span>
            <kbd className="text-[10px] text-zinc-600 font-mono">⌘N</kbd>
          </Link>
        </div>

        {/* ── Threads List ─────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-2 py-1">
          <div className="px-2 py-1.5">
            <span className="text-[10px] font-mono uppercase text-zinc-600 tracking-wider">
              Threads
            </span>
          </div>

          {loading ? (
            <div className="space-y-1.5 px-1">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-8 bg-zinc-800/30 rounded animate-pulse"
                />
              ))}
            </div>
          ) : sortedThreads.length === 0 ? (
            <div className="px-2 py-4 text-center">
              <p className="text-[11px] text-zinc-600">No threads yet</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {sortedThreads.map((thread) => {
                const isSelected =
                  pathname === `/projects/${projectId}/threads/${thread.id}`;
                return (
                  <Link
                    key={thread.id}
                    href={`/projects/${projectId}/threads/${thread.id}`}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors group min-w-0",
                      isSelected
                        ? "bg-zinc-800/60 text-zinc-100"
                        : "hover:bg-zinc-800/40 text-zinc-400",
                    )}
                  >
                    {/* Status dot */}
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        threadStatusDot[thread.status] || "bg-zinc-600",
                      )}
                    />

                    {/* Title + branch */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm truncate">{thread.title}</span>
                        {thread.worktreeBranch && (
                          <span className="text-[9px] font-mono bg-zinc-800 text-zinc-500 px-1.5 rounded shrink-0 flex items-center gap-0.5">
                            <GitBranch className="h-2.5 w-2.5" />
                            {thread.worktreeBranch}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Time ago */}
                    <span className="text-[10px] text-zinc-600 shrink-0">
                      {timeAgo(thread.updatedAt)}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}

          {/* ── Issues Section ───────────────────────────────── */}
          {project && project.issues.length > 0 && (
            <>
              <div className="px-2 py-1.5 mt-3">
                <span className="text-[10px] font-mono uppercase text-zinc-600 tracking-wider">
                  Issues ({project.issues.length})
                </span>
              </div>

              <div className="space-y-0.5">
                {project.issues.map((issue) => (
                  <div
                    key={issue.id}
                    className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-zinc-800/40 transition-colors min-w-0 cursor-pointer"
                  >
                    <CircleDot
                      className={cn(
                        "h-3 w-3 shrink-0",
                        issueStatusColor[issue.status] || "text-zinc-400",
                      )}
                    />
                    <span className="text-[11px] text-zinc-500 shrink-0 font-mono">
                      {issue.identifier}
                    </span>
                    <span className="text-sm text-zinc-400 truncate">
                      {issue.title}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── Archive Section ───────────────────────────────── */}
          <div className="mt-3">
            <button
              onClick={() => setArchiveOpen(!archiveOpen)}
              className="flex items-center gap-1.5 px-2 py-1.5 w-full text-left hover:bg-zinc-800/30 rounded transition-colors"
            >
              <Archive className="h-3 w-3 text-zinc-600" />
              <span className="text-[10px] font-mono uppercase text-zinc-600 tracking-wider">
                Archive
              </span>
              <span className="text-[10px] text-zinc-700 ml-auto">
                {archiveOpen ? "▾" : "▸"}
              </span>
            </button>

            {archiveOpen && (
              <div className="space-y-0.5 mt-0.5">
                {archiveLoading ? (
                  <div className="px-2.5 py-2 text-[11px] text-zinc-600">Loading...</div>
                ) : archiveItems.length === 0 ? (
                  <div className="px-2.5 py-2 text-[11px] text-zinc-600">No archived issues</div>
                ) : (
                  archiveItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-zinc-800/40 transition-colors min-w-0"
                    >
                      <Archive className="h-3 w-3 shrink-0 text-zinc-600" />
                      <span className="text-[11px] text-zinc-600 shrink-0 font-mono">
                        {item.identifier}
                      </span>
                      <span className="text-sm text-zinc-500 truncate">
                        {item.title}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
