"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Plus, Search, PanelLeftClose, PanelLeft, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThreadItem {
  id: string;
  title: string;
  provider: string;
  status: string;
  updatedAt: string;
}

const statusColor: Record<string, string> = {
  active: "bg-green-500",
  starting: "bg-amber-500 animate-pulse",
  idle: "bg-muted-foreground/30",
  error: "bg-red-500",
};

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

function groupByDate(threads: ThreadItem[]): Array<{ label: string; threads: ThreadItem[] }> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);

  const groups: Record<string, ThreadItem[]> = {
    Today: [],
    Yesterday: [],
    "This Week": [],
    Older: [],
  };

  for (const thread of threads) {
    const d = new Date(thread.updatedAt);
    if (d >= today) groups["Today"].push(thread);
    else if (d >= yesterday) groups["Yesterday"].push(thread);
    else if (d >= weekAgo) groups["This Week"].push(thread);
    else groups["Older"].push(thread);
  }

  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, threads]) => ({ label, threads }));
}

export function ThreadSidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [search, setSearch] = useState("");
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    api.listThreads().then(setThreads).catch(console.error);
  }, []);

  useEffect(() => {
    api.listThreads().then(setThreads).catch(console.error);
  }, [pathname]);

  const filtered = search
    ? threads.filter((t) =>
        t.title.toLowerCase().includes(search.toLowerCase())
      )
    : threads;

  const grouped = groupByDate(filtered);

  if (collapsed) {
    return (
      <div className="w-12 border-r border-border/20 flex flex-col items-center py-3 gap-2 shrink-0 bg-muted/5">
        <button
          onClick={onToggle}
          className="p-2 rounded-md hover:bg-muted/50 transition-colors text-muted-foreground/50"
          title="Expand sidebar (Cmd+B)"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <Link href="/threads/new" title="New Thread">
          <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground/50">
            <Plus className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="w-[280px] border-r border-border/20 flex flex-col shrink-0 bg-muted/5">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-border/20">
        <span className="text-sm font-semibold tracking-tight text-foreground/80">Threads</span>
        <div className="flex items-center gap-0.5">
          <Link href="/threads/new">
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground/50 hover:text-foreground" title="New Thread (Cmd+N)">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </Link>
          <button
            onClick={onToggle}
            className="p-1.5 rounded-md hover:bg-muted/50 transition-colors text-muted-foreground/40"
            title="Collapse sidebar (Cmd+B)"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/30" />
          <Input
            placeholder="Search threads..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs bg-muted/20 border-border/20 focus:border-primary/30"
          />
        </div>
      </div>

      {/* Thread list */}
      <ScrollArea className="flex-1 overflow-auto">
        <div className="px-2 py-1">
          {grouped.map((group) => (
            <div key={group.label}>
              <div className="px-2 py-1.5 mt-1 first:mt-0">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/30">
                  {group.label}
                </span>
              </div>
              {group.threads.map((thread) => {
                const isActive = pathname === `/threads/${thread.id}`;
                return (
                  <button
                    key={thread.id}
                    onClick={() => router.push(`/threads/${thread.id}`)}
                    className={cn(
                      "w-full text-left rounded-lg px-2.5 py-2 transition-all group",
                      isActive
                        ? "bg-primary/10 text-foreground"
                        : "hover:bg-muted/30 text-foreground/70"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <MessageSquare className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        isActive ? "text-primary" : "text-muted-foreground/30"
                      )} />
                      <span className="text-[13px] truncate flex-1">
                        {thread.title}
                      </span>
                      <span
                        className={cn(
                          "w-1.5 h-1.5 rounded-full shrink-0",
                          statusColor[thread.status] || "bg-muted-foreground/20"
                        )}
                      />
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 ml-5.5 pl-0.5">
                      <span className="text-[10px] font-mono text-muted-foreground/40">
                        {thread.provider}
                      </span>
                      <span className="text-[10px] text-muted-foreground/25">
                        {timeAgo(thread.updatedAt)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-8">
              <MessageSquare className="h-8 w-8 text-muted-foreground/15 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground/30">
                {search ? "No matching threads" : "No threads yet"}
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
