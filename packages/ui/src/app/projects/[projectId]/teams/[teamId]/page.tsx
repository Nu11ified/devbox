"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, type TeamItem } from "@/lib/api";
import { TeamPane } from "@/components/team/team-pane";
import { TeamActivityBar, type ActivityItem } from "@/components/team/team-activity-bar";
import { Square, Archive, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Grid layout helpers ─────────────────────────────────────────────

function gridClass(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-2";
  if (count === 3) return "grid-cols-3";
  if (count === 4) return "grid-cols-2";
  return "grid-cols-3"; // 5-6
}

// ── Team status helpers ─────────────────────────────────────────────

const statusDotClass: Record<string, string> = {
  active: "bg-emerald-400 animate-pulse",
  running: "bg-emerald-400 animate-pulse",
  idle: "bg-zinc-500",
  stopped: "bg-zinc-500",
  archived: "bg-zinc-600",
  error: "bg-red-400",
};

// ── Page component ──────────────────────────────────────────────────

export default function TeamPage() {
  const { projectId, teamId } = useParams<{
    projectId: string;
    teamId: string;
  }>();
  const router = useRouter();

  const [team, setTeam] = useState<TeamItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [stopping, setStopping] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // ── Load + poll team data ───────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    function fetchTeam() {
      api
        .getTeam(projectId, teamId)
        .then((data) => {
          if (!cancelled) {
            setTeam(data);
            setLoading(false);
          }
        })
        .catch((err) => {
          console.error("Failed to fetch team:", err);
          if (!cancelled) setLoading(false);
        });
    }

    fetchTeam();
    const interval = setInterval(fetchTeam, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId, teamId]);

  // ── Team message handler (called by each TeamPane) ──────────────
  const handleTeamMessage = useCallback(
    (msg: { fromName: string; content: string; toThreadId?: string }) => {
      const toName =
        team?.members.find((m) => m.threadId === msg.toThreadId)?.name ??
        "all";
      setActivityItems((prev) => [
        ...prev,
        {
          id: `activity-${Date.now()}-${Math.random()}`,
          type: "message",
          fromName: msg.fromName,
          toName,
          content: msg.content,
          timestamp: new Date(),
        } satisfies ActivityItem,
      ]);
    },
    [team]
  );

  // ── Stop All ────────────────────────────────────────────────────
  async function handleStopAll() {
    if (stopping) return;
    setStopping(true);
    try {
      await api.stopTeam(projectId, teamId);
    } catch (err) {
      console.error("Failed to stop team:", err);
    } finally {
      setStopping(false);
    }
  }

  // ── Archive ─────────────────────────────────────────────────────
  async function handleArchive() {
    if (archiving) return;
    setArchiving(true);
    try {
      await api.archiveTeam(projectId, teamId);
      router.push(`/projects/${projectId}`);
    } catch (err) {
      console.error("Failed to archive team:", err);
      setArchiving(false);
    }
  }

  // ── Keyboard shortcuts ──────────────────────────────────────────
  const memberCount = team?.members.length ?? 0;

  useEffect(() => {
    if (!team) return;

    function handleKeyDown(e: KeyboardEvent) {
      const members = team!.members;
      const count = members.length;
      if (count === 0) return;

      // Tab / Shift+Tab — cycle focus
      if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setFocusedIndex((prev) =>
          e.shiftKey ? (prev - 1 + count) % count : (prev + 1) % count
        );
        return;
      }

      // Cmd+1-9 — focus pane by number
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        const num = parseInt(e.key, 10);
        if (!isNaN(num) && num >= 1 && num <= 9) {
          const idx = num - 1;
          if (idx < count) {
            e.preventDefault();
            setFocusedIndex(idx);
          }
          return;
        }
      }

      // Cmd+Shift+S — stop all
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "s"
      ) {
        e.preventDefault();
        handleStopAll();
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team]);

  // ── Render ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (!team) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-zinc-500">Team not found.</p>
      </div>
    );
  }

  const dotClass =
    statusDotClass[team.status] ?? "bg-zinc-500";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header bar ── */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-zinc-800/60 bg-zinc-950/80">
        {/* Left: team name + meta */}
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={cn("w-2 h-2 rounded-full shrink-0", dotClass)}
            title={team.status}
          />
          <h1 className="text-sm font-semibold text-zinc-100 truncate">
            {team.name}
          </h1>
          <span className="text-[11px] text-zinc-500 shrink-0">
            {memberCount} {memberCount === 1 ? "agent" : "agents"}
          </span>
          <span className="text-[11px] font-mono text-zinc-600 shrink-0 capitalize">
            ● {team.status}
          </span>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleStopAll}
            disabled={stopping}
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors",
              "border border-zinc-700/60 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600/60",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
            title="Stop all agents (⌘⇧S)"
          >
            {stopping ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Square className="h-3 w-3" />
            )}
            Stop All
          </button>

          <button
            onClick={handleArchive}
            disabled={archiving}
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors",
              "border border-zinc-700/60 text-zinc-400 hover:text-red-400 hover:border-red-500/40",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
            title="Archive team"
          >
            {archiving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Archive className="h-3 w-3" />
            )}
            Archive
          </button>
        </div>
      </div>

      {/* ── Pane grid ── */}
      {memberCount === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-zinc-500">No agents in this team.</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div
            className={cn(
              "flex-1 min-h-0 grid gap-2 p-2 overflow-hidden",
              gridClass(memberCount)
            )}
          >
            {team.members.map((member, idx) => (
              <TeamPane
                key={member.threadId}
                threadId={member.threadId}
                agentName={member.name}
                role={member.role === "lead" ? "lead" : "teammate"}
                focused={focusedIndex === idx}
                onFocus={() => setFocusedIndex(idx)}
                onTeamMessage={handleTeamMessage}
              />
            ))}
          </div>

          {/* ── Activity bar ── */}
          <TeamActivityBar items={activityItems} />
        </div>
      )}
    </div>
  );
}
