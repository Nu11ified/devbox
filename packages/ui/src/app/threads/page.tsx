"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Plus, MessageSquare, Loader2, Trash2 } from "lucide-react";

interface ThreadItem {
  id: string;
  title: string;
  provider: string;
  model: string | null;
  status: string;
  runtimeMode: string;
  createdAt: string;
  updatedAt: string;
  _count: { turns: number; events: number };
}

export default function ThreadsPage() {
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    api.listThreads()
      .then(setThreads)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(e: React.MouseEvent, threadId: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Delete this thread?")) return;

    setDeleting(threadId);
    try {
      // Stop the thread first if it's active (ignore errors)
      await api.stopThread(threadId).catch(() => {});
      await api.deleteThread(threadId);
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
    } catch (err: any) {
      console.error("Failed to delete thread:", err);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold tracking-tight">Threads</h1>
        <Link href="/threads/new">
          <Button size="sm">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New Thread
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : threads.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <MessageSquare className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No threads yet. Start a new session.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map((thread) => (
            <Link
              key={thread.id}
              href={`/threads/${thread.id}`}
              className="block border rounded-lg p-3 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{thread.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] font-mono text-muted-foreground/60">
                      {thread.provider}
                    </span>
                    {thread.model && (
                      <span className="text-[10px] font-mono text-muted-foreground/40">
                        {thread.model}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground/40">
                      {thread._count.turns} turns
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-3">
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                      thread.status === "active"
                        ? "bg-green-500/10 text-green-500"
                        : "bg-muted text-muted-foreground/60"
                    }`}
                  >
                    {thread.status}
                  </span>
                  <button
                    onClick={(e) => handleDelete(e, thread.id)}
                    disabled={deleting === thread.id}
                    className="p-1 rounded hover:bg-destructive/10 text-muted-foreground/40 hover:text-destructive transition-colors"
                    title="Delete thread"
                  >
                    {deleting === thread.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
