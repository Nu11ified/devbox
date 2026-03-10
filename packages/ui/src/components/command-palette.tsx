"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommandPalette, type Command } from "@/hooks/use-command-palette";

export function CommandPalette() {
  const { open, setOpen, commands, recentIds, addRecent } = useCommandPalette();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      // Focus input after a tick so the DOM is rendered
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [open]);

  // Filter and group commands
  const availableCommands = useMemo(() => {
    return commands.filter((cmd) => {
      if (cmd.available && !cmd.available()) return false;
      if (query) {
        return cmd.label.toLowerCase().includes(query.toLowerCase());
      }
      return true;
    });
  }, [commands, query]);

  // Sort: recent first when no query, then group by Navigation/Actions
  const sortedCommands = useMemo(() => {
    if (query) {
      // When searching, just sort by group
      const nav = availableCommands.filter((c) => c.group === "Navigation");
      const actions = availableCommands.filter((c) => c.group === "Actions");
      return [...nav, ...actions];
    }
    // No query: recent first, then rest grouped
    const recentSet = new Set(recentIds);
    const recent = recentIds
      .map((id) => availableCommands.find((c) => c.id === id))
      .filter(Boolean) as Command[];
    const rest = availableCommands.filter((c) => !recentSet.has(c.id));
    const nav = rest.filter((c) => c.group === "Navigation");
    const actions = rest.filter((c) => c.group === "Actions");
    return [...recent, ...nav, ...actions];
  }, [availableCommands, query, recentIds]);

  // Build grouped display with headers
  const groupedItems = useMemo(() => {
    const items: Array<
      | { type: "header"; label: string }
      | { type: "command"; command: Command; flatIndex: number }
    > = [];
    let flatIndex = 0;

    if (!query && recentIds.length > 0) {
      const recentSet = new Set(recentIds);
      const recentCmds = sortedCommands.filter((c) => recentSet.has(c.id));
      if (recentCmds.length > 0) {
        items.push({ type: "header", label: "Recent" });
        for (const cmd of recentCmds) {
          items.push({ type: "command", command: cmd, flatIndex });
          flatIndex++;
        }
      }
      const navCmds = sortedCommands.filter(
        (c) => !recentSet.has(c.id) && c.group === "Navigation",
      );
      if (navCmds.length > 0) {
        items.push({ type: "header", label: "Navigation" });
        for (const cmd of navCmds) {
          items.push({ type: "command", command: cmd, flatIndex });
          flatIndex++;
        }
      }
      const actionCmds = sortedCommands.filter(
        (c) => !recentSet.has(c.id) && c.group === "Actions",
      );
      if (actionCmds.length > 0) {
        items.push({ type: "header", label: "Actions" });
        for (const cmd of actionCmds) {
          items.push({ type: "command", command: cmd, flatIndex });
          flatIndex++;
        }
      }
    } else {
      const navCmds = sortedCommands.filter((c) => c.group === "Navigation");
      if (navCmds.length > 0) {
        items.push({ type: "header", label: "Navigation" });
        for (const cmd of navCmds) {
          items.push({ type: "command", command: cmd, flatIndex });
          flatIndex++;
        }
      }
      const actionCmds = sortedCommands.filter((c) => c.group === "Actions");
      if (actionCmds.length > 0) {
        items.push({ type: "header", label: "Actions" });
        for (const cmd of actionCmds) {
          items.push({ type: "command", command: cmd, flatIndex });
          flatIndex++;
        }
      }
    }

    return items;
  }, [sortedCommands, query, recentIds]);

  const flatCount = sortedCommands.length;

  // Clamp selected index
  useEffect(() => {
    if (selectedIndex >= flatCount) {
      setSelectedIndex(Math.max(0, flatCount - 1));
    }
  }, [flatCount, selectedIndex]);

  const selectCommand = useCallback(
    (cmd: Command) => {
      addRecent(cmd.id);
      setOpen(false);
      cmd.onSelect();
    },
    [addRecent, setOpen],
  );

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, flatCount));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(
          (prev) => (prev - 1 + Math.max(1, flatCount)) % Math.max(1, flatCount),
        );
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const cmd = sortedCommands[selectedIndex];
        if (cmd) selectCommand(cmd);
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, flatCount, selectedIndex, sortedCommands, selectCommand, setOpen]);

  // Scroll selected item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const selected = listRef.current.querySelector(
      `[data-flat-index="${selectedIndex}"]`,
    );
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, open]);

  if (!open) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm",
        "transition-opacity duration-100",
        open ? "opacity-100" : "opacity-0 pointer-events-none",
      )}
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-zinc-900 border border-zinc-700/60 rounded-xl shadow-2xl w-full max-w-lg mx-auto mt-[20vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
          <Search className="h-4 w-4 text-zinc-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Type a command..."
            className="bg-transparent flex-1 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none"
          />
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[300px] overflow-auto py-1">
          {groupedItems.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-zinc-500">
              No commands found
            </div>
          )}
          {groupedItems.map((item, i) => {
            if (item.type === "header") {
              return (
                <div
                  key={`header-${item.label}`}
                  className="px-4 py-1.5 text-[10px] font-mono uppercase tracking-wider text-zinc-600"
                >
                  {item.label}
                </div>
              );
            }

            const { command: cmd, flatIndex } = item;
            const isSelected = flatIndex === selectedIndex;

            return (
              <button
                key={cmd.id}
                data-flat-index={flatIndex}
                onClick={() => selectCommand(cmd)}
                onMouseEnter={() => setSelectedIndex(flatIndex)}
                className={cn(
                  "px-4 py-2.5 flex items-center gap-3 text-sm cursor-pointer w-full text-left transition-colors",
                  isSelected
                    ? "bg-zinc-800/70 text-zinc-100"
                    : "text-zinc-400 hover:bg-zinc-800/50",
                )}
              >
                {cmd.icon && (
                  <cmd.icon className="h-4 w-4 shrink-0" />
                )}
                <span className="flex-1 truncate">{cmd.label}</span>
                {cmd.shortcut && (
                  <span className="text-zinc-600 text-xs font-mono shrink-0">
                    {cmd.shortcut}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
