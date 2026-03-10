"use client";

import { useEffect, useState, useCallback } from "react";
import { api, type PluginItem } from "@/lib/api";
import {
  Loader2,
  Search,
  Filter,
  X,
  Check,
  Download,
  BadgeCheck,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

const CATEGORY_LABELS: Record<string, string> = {
  development: "Development",
  productivity: "Productivity",
  security: "Security",
  database: "Database",
  "language-server": "Language Server",
  integration: "Integration",
  general: "General",
};

const CATEGORY_COLORS: Record<string, string> = {
  development: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  productivity: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  security: "bg-red-500/10 text-red-400 border-red-500/20",
  database: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  "language-server": "bg-amber-500/10 text-amber-400 border-amber-500/20",
  integration: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  general: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
};

export default function PluginsPage() {
  const [plugins, setPlugins] = useState<PluginItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [toggling, setToggling] = useState<Set<string>>(new Set());

  const fetchPlugins = useCallback(async () => {
    try {
      const data = await api.listPlugins();
      setPlugins(data);
    } catch (err) {
      console.error("Failed to load plugins:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlugins();
  }, [fetchPlugins]);

  async function handleToggle(plugin: PluginItem) {
    setToggling((prev) => new Set(prev).add(plugin.id));
    try {
      if (plugin.installed) {
        await api.uninstallPlugin(plugin.id);
      } else {
        await api.installPlugin(plugin.id);
      }
      setPlugins((prev) =>
        prev.map((p) =>
          p.id === plugin.id
            ? {
                ...p,
                installed: !p.installed,
                installCount: p.installed
                  ? p.installCount - 1
                  : p.installCount + 1,
              }
            : p
        )
      );
    } catch (err) {
      console.error("Failed to toggle plugin:", err);
    } finally {
      setToggling((prev) => {
        const next = new Set(prev);
        next.delete(plugin.id);
        return next;
      });
    }
  }

  const categories = Array.from(new Set(plugins.map((p) => p.category)));
  const installedCount = plugins.filter((p) => p.installed).length;

  const filtered = plugins.filter((p) => {
    if (activeCategory && p.category !== activeCategory) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        (p.tags as string[]).some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/30" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight">Plugins</h1>
          <p className="text-sm text-muted-foreground/60 mt-1">
            Browse plugins from the Anthropic Claude Code marketplace.
            Install plugins to enable them for your agents.
          </p>
          <div className="flex items-center gap-3 mt-3">
            <span className="text-xs font-mono text-muted-foreground/50">
              {plugins.length} available
            </span>
            <span className="text-xs text-muted-foreground/30">|</span>
            <span className="text-xs font-mono text-primary/70">
              {installedCount} installed
            </span>
          </div>
        </div>

        {/* Search + Filter bar */}
        <div className="flex items-center gap-3 mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/40" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search plugins..."
              className="w-full pl-9 pr-3 py-2 text-sm bg-muted/30 border border-border/30 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary/30 placeholder:text-muted-foreground/30"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted/50"
              >
                <X className="h-3 w-3 text-muted-foreground/40" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-muted-foreground/40" />
            <button
              onClick={() => setActiveCategory(null)}
              className={cn(
                "px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors",
                !activeCategory
                  ? "bg-foreground/10 text-foreground"
                  : "text-muted-foreground/50 hover:text-foreground/70 hover:bg-muted/30"
              )}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() =>
                  setActiveCategory(activeCategory === cat ? null : cat)
                }
                className={cn(
                  "px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors",
                  activeCategory === cat
                    ? "bg-foreground/10 text-foreground"
                    : "text-muted-foreground/50 hover:text-foreground/70 hover:bg-muted/30"
                )}
              >
                {CATEGORY_LABELS[cat] || cat}
              </button>
            ))}
          </div>
        </div>

        {/* Plugin grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              toggling={toggling.has(plugin.id)}
              onToggle={() => handleToggle(plugin)}
            />
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-16">
            <p className="text-sm text-muted-foreground/40">
              No plugins match your search.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function PluginCard({
  plugin,
  toggling,
  onToggle,
}: {
  plugin: PluginItem;
  toggling: boolean;
  onToggle: () => void;
}) {
  const catColor =
    CATEGORY_COLORS[plugin.category] || CATEGORY_COLORS.general;

  return (
    <div
      className={cn(
        "group relative flex flex-col rounded-xl border transition-all duration-200",
        plugin.installed
          ? "border-primary/20 bg-primary/[0.02]"
          : "border-border/30 bg-card/50 hover:border-border/60 hover:bg-card/80"
      )}
    >
      <div className="p-4 flex-1">
        {/* Top row: icon + category badge */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <span className="text-xl leading-none">{plugin.icon || "🔧"}</span>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-medium leading-tight">
                  {plugin.name}
                </h3>
                {plugin.verified && (
                  <BadgeCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                )}
              </div>
              <span className="text-[10px] font-mono text-muted-foreground/40">
                v{plugin.version}
              </span>
            </div>
          </div>
          <span
            className={cn(
              "text-[10px] font-mono px-2 py-0.5 rounded-full border",
              catColor
            )}
          >
            {CATEGORY_LABELS[plugin.category] || plugin.category}
          </span>
        </div>

        {/* Description */}
        <p className="text-xs text-muted-foreground/60 leading-relaxed line-clamp-3 mb-3">
          {plugin.description}
        </p>

        {/* Tags */}
        <div className="flex flex-wrap gap-1">
          {(plugin.tags as string[]).slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="text-[10px] font-mono text-muted-foreground/30 bg-muted/20 px-1.5 py-0.5 rounded"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border/20 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-muted-foreground/30">
            by {plugin.author}
          </span>
          {plugin.homepage && (
            <a
              href={plugin.homepage}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>

        <button
          onClick={onToggle}
          disabled={toggling}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200",
            toggling && "opacity-50 cursor-not-allowed",
            plugin.installed
              ? "text-primary/70 bg-primary/10 hover:bg-red-500/10 hover:text-red-400 group-hover:[&]:bg-red-500/10 group-hover:[&]:text-red-400"
              : "text-foreground/70 bg-foreground/5 hover:bg-primary/10 hover:text-primary"
          )}
        >
          {toggling ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : plugin.installed ? (
            <>
              <Check className="h-3 w-3 group-hover:hidden" />
              <X className="h-3 w-3 hidden group-hover:block" />
              <span className="group-hover:hidden">Installed</span>
              <span className="hidden group-hover:inline">Remove</span>
            </>
          ) : (
            <>
              <Download className="h-3 w-3" />
              Install
            </>
          )}
        </button>
      </div>
    </div>
  );
}
