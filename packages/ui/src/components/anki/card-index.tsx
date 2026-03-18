"use client";

import { useState } from "react";
import { Search, ChevronRight, AlertTriangle, Eye, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnkiCard } from "@/lib/api";

interface CardIndexProps {
  cards: AnkiCard[];
  selectedId: string | null;
  onSelect: (card: AnkiCard) => void;
  onNewCard: () => void;
}

export function CardIndex({ cards, selectedId, onSelect, onNewCard }: CardIndexProps) {
  const [search, setSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const filtered = cards.filter((card) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return card.title.toLowerCase().includes(q) || card.group.toLowerCase().includes(q);
  });

  // Group cards by group field, sorted by accessCount descending within each group
  const grouped = filtered.reduce<Record<string, AnkiCard[]>>((acc, card) => {
    if (!acc[card.group]) acc[card.group] = [];
    acc[card.group].push(card);
    return acc;
  }, {});

  for (const group of Object.keys(grouped)) {
    grouped[group].sort((a, b) => b.accessCount - a.accessCount);
  }

  const groupNames = Object.keys(grouped).sort();

  function toggleGroup(group: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  return (
    <div className="flex flex-col h-full border-r border-zinc-800/40">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-zinc-800/40">
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Knowledge Cards
        </span>
        <button
          onClick={onNewCard}
          className="flex items-center gap-1 text-xs bg-zinc-800/50 hover:bg-zinc-700/50 text-zinc-300 px-2 py-1 rounded transition-colors"
        >
          <Plus className="h-3 w-3" />
          New Card
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-zinc-800/40">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search cards..."
            className="w-full pl-8 pr-3 py-1.5 bg-zinc-900/50 border border-zinc-800/40 rounded text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
          />
        </div>
      </div>

      {/* Card list */}
      <div className="flex-1 overflow-y-auto">
        {cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center">
            <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-3">
              <Eye className="h-4 w-4 text-violet-500/60" />
            </div>
            <p className="text-sm text-zinc-500">No cards yet</p>
            <p className="text-xs text-zinc-600 mt-1">Create a card to get started</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-zinc-500">No cards match your search</p>
          </div>
        ) : (
          <div className="py-1">
            {groupNames.map((group) => {
              const isCollapsed = collapsedGroups.has(group);
              const groupCards = grouped[group];
              return (
                <div key={group}>
                  {/* Group header */}
                  <button
                    onClick={() => toggleGroup(group)}
                    className="flex items-center gap-1.5 w-full px-3 py-1.5 hover:bg-zinc-800/30 transition-colors text-left"
                  >
                    <ChevronRight
                      className={cn(
                        "h-3 w-3 text-zinc-500 transition-transform",
                        !isCollapsed && "rotate-90"
                      )}
                    />
                    <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                      {group}
                    </span>
                    <span className="ml-auto text-xs text-zinc-600">
                      {groupCards.length}
                    </span>
                  </button>

                  {/* Group cards */}
                  {!isCollapsed &&
                    groupCards.map((card) => (
                      <button
                        key={card.id}
                        onClick={() => onSelect(card)}
                        className={cn(
                          "flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-zinc-800/40 transition-colors",
                          selectedId === card.id && "bg-zinc-800/60"
                        )}
                      >
                        {/* Stale indicator */}
                        {card.stale ? (
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500/70" />
                        ) : (
                          <div className="h-3.5 w-3.5 shrink-0" />
                        )}

                        {/* Title */}
                        <span
                          className={cn(
                            "flex-1 min-w-0 text-sm truncate",
                            selectedId === card.id ? "text-zinc-100" : "text-zinc-300"
                          )}
                        >
                          {card.title}
                        </span>

                        {/* Access count badge */}
                        {card.accessCount > 0 && (
                          <span className="flex items-center gap-0.5 shrink-0 text-xs text-zinc-600">
                            <Eye className="h-3 w-3" />
                            {card.accessCount}
                          </span>
                        )}
                      </button>
                    ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
