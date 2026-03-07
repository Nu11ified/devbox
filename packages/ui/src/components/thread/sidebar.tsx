"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Plus, Search, PanelLeftClose, PanelLeft } from "lucide-react";
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
  starting: "bg-yellow-500",
  idle: "bg-gray-400",
  error: "bg-red-500",
};

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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

  // Re-fetch when navigating (e.g. after creating a thread)
  useEffect(() => {
    api.listThreads().then(setThreads).catch(console.error);
  }, [pathname]);

  const filtered = search
    ? threads.filter((t) =>
        t.title.toLowerCase().includes(search.toLowerCase())
      )
    : threads;

  if (collapsed) {
    return (
      <div className="w-12 border-r border-border/40 flex flex-col items-center py-2 gap-2 shrink-0">
        <button
          onClick={onToggle}
          className="p-2 rounded-md hover:bg-muted transition-colors text-muted-foreground"
          title="Expand sidebar"
        >
          <PanelLeft className="h-4 w-4" />
        </button>
        <Link href="/threads/new" title="New Thread">
          <Button size="icon" variant="ghost" className="h-8 w-8">
            <Plus className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="w-[280px] border-r border-border/40 flex flex-col shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/40">
        <span className="text-sm font-semibold tracking-tight">Threads</span>
        <div className="flex items-center gap-1">
          <Link href="/threads/new">
            <Button size="icon" variant="ghost" className="h-7 w-7" title="New Thread">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </Link>
          <button
            onClick={onToggle}
            className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground"
            title="Collapse sidebar"
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
          <Input
            placeholder="Search threads..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      {/* Thread list */}
      <ScrollArea className="flex-1 overflow-auto">
        <div className="px-2 py-1 space-y-0.5">
          {filtered.map((thread) => {
            const isActive = pathname === `/threads/${thread.id}`;
            return (
              <button
                key={thread.id}
                onClick={() => router.push(`/threads/${thread.id}`)}
                className={cn(
                  "w-full text-left rounded-md px-2.5 py-2 transition-colors group",
                  isActive
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted/50 text-foreground"
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn(
                      "w-2 h-2 rounded-full shrink-0",
                      statusColor[thread.status] || "bg-gray-400"
                    )}
                  />
                  <span className="text-sm truncate flex-1">
                    {thread.title}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1 ml-4">
                  <span className="text-[10px] font-mono text-muted-foreground/60">
                    {thread.provider}
                  </span>
                  <span className="text-[10px] text-muted-foreground/40">
                    {timeAgo(thread.updatedAt)}
                  </span>
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground/50 text-center py-6">
              {search ? "No matching threads" : "No threads yet"}
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
