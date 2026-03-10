"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, Archive, GitPullRequest } from "lucide-react";
import { api, type ArchiveSearchResult, type ArchiveSearchResponse } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

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

const statusColors: Record<string, string> = {
  done: "bg-emerald-900/30 text-emerald-400 border-emerald-700/30",
  cancelled: "bg-red-900/30 text-red-400 border-red-700/30",
  archived: "bg-zinc-800/50 text-zinc-400 border-zinc-700/30",
};

export default function ArchivePage() {
  const router = useRouter();
  const { data: projects } = useApi(() => api.listProjects(), []);

  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [searchResults, setSearchResults] = useState<ArchiveSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Load initial archive on mount
  const { data: initialData, loading: initialLoading } = useApi(
    () => api.searchArchive({ page: 1, limit: 20 }),
    []
  );

  const doSearch = useCallback(async (searchPage = 1) => {
    setLoading(true);
    setHasSearched(true);
    try {
      const result = await api.searchArchive({
        q: query || undefined,
        projectId: projectFilter !== "all" ? projectFilter : undefined,
        page: searchPage,
        limit: 20,
      });
      setSearchResults(result);
      setPage(searchPage);
    } catch (err) {
      console.error("Archive search failed:", err);
    } finally {
      setLoading(false);
    }
  }, [query, projectFilter]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    doSearch(1);
  };

  const data = hasSearched ? searchResults : initialData;
  const results = data?.results ?? [];
  const isLoading = hasSearched ? loading : initialLoading;

  function handleResultClick(result: ArchiveSearchResult) {
    if (result.projectId && result.threadId) {
      router.push(`/projects/${result.projectId}/threads/${result.threadId}`);
    } else if (result.projectId) {
      router.push(`/projects/${result.projectId}`);
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Archive className="h-6 w-6 text-zinc-400" />
          Archive
        </h1>
        <p className="text-sm text-muted-foreground/70 mt-0.5">
          Search completed issues and past thread transcripts
        </p>
      </div>

      {/* Search bar */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search archived issues and threads..."
            className="pl-9 bg-zinc-900/50 border-zinc-800/60"
          />
        </div>
        <Select value={projectFilter} onValueChange={(v) => setProjectFilter(v)}>
          <SelectTrigger className="w-[180px] bg-zinc-900/50 border-zinc-800/60">
            <SelectValue placeholder="All Projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {(projects ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" size="sm" disabled={isLoading}>
          Search
        </Button>
      </form>

      {/* Results */}
      {isLoading && (
        <div className="py-12 text-center text-muted-foreground text-sm">
          Searching...
        </div>
      )}

      {!isLoading && results.length === 0 && (
        <div className="py-12 text-center text-muted-foreground/60 text-sm">
          {hasSearched ? "No results found" : "No archived issues yet"}
        </div>
      )}

      {!isLoading && results.length > 0 && (
        <div className="space-y-2">
          {results.map((result) => (
            <div
              key={result.id}
              className="border border-zinc-800/40 rounded-lg p-3 hover:border-zinc-700/60 hover:bg-zinc-900/30 transition-all cursor-pointer"
              onClick={() => handleResultClick(result)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-zinc-500">
                      {result.identifier}
                    </span>
                    <span className="text-sm font-medium text-zinc-200 truncate">
                      {result.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded-full border",
                      statusColors[result.status] ?? statusColors.archived
                    )}>
                      {result.status}
                    </span>
                    {result.projectName && (
                      <span className="text-[11px] text-zinc-500">
                        {result.projectName}
                      </span>
                    )}
                    {result.archivedAt && (
                      <span className="text-[11px] text-zinc-600">
                        {timeAgo(result.archivedAt)}
                      </span>
                    )}
                    {result.prUrl && (
                      <a
                        href={result.prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] text-purple-400 hover:text-purple-300"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <GitPullRequest className="w-3 h-3" />
                        PR
                      </a>
                    )}
                  </div>
                </div>
              </div>
              {result.snippet && result.snippet.trim() && (
                <p className="mt-2 text-xs text-zinc-500 leading-relaxed border-t border-zinc-800/30 pt-2 line-clamp-3">
                  {result.snippet}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && results.length > 0 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => doSearch(page - 1)}
            className="text-xs"
          >
            Previous
          </Button>
          <span className="text-xs text-zinc-500">Page {page}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={results.length < 20}
            onClick={() => doSearch(page + 1)}
            className="text-xs"
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
