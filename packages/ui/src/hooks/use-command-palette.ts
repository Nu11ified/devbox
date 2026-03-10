"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import React from "react";

export interface Command {
  id: string;
  label: string;
  group: "Navigation" | "Actions";
  icon?: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  onSelect: () => void;
  available?: () => boolean;
}

interface CommandPaletteContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  commands: Command[];
  registerCommands: (cmds: Command[]) => () => void;
  recentIds: string[];
  addRecent: (id: string) => void;
}

const RECENT_KEY = "patchwork-command-palette-recent";
const MAX_RECENT = 5;

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(
  null,
);

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.slice(0, MAX_RECENT);
    }
  } catch {}
  return [];
}

function saveRecent(ids: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, MAX_RECENT)));
  } catch {}
}

export function CommandPaletteProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const commandSetsRef = useRef<Map<symbol, Command[]>>(new Map());
  const [commands, setCommands] = useState<Command[]>([]);

  // Load recent on mount
  useEffect(() => {
    setRecentIds(loadRecent());
  }, []);

  const addRecent = useCallback((id: string) => {
    setRecentIds((prev) => {
      const next = [id, ...prev.filter((r) => r !== id)].slice(0, MAX_RECENT);
      saveRecent(next);
      return next;
    });
  }, []);

  const rebuildCommands = useCallback(() => {
    const all: Command[] = [];
    commandSetsRef.current.forEach((cmds) => all.push(...cmds));
    setCommands(all);
  }, []);

  const registerCommands = useCallback(
    (cmds: Command[]) => {
      const key = Symbol();
      commandSetsRef.current.set(key, cmds);
      rebuildCommands();
      return () => {
        commandSetsRef.current.delete(key);
        rebuildCommands();
      };
    },
    [rebuildCommands],
  );

  // Listen for Cmd+K / Ctrl+K
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (
        e.key.toLowerCase() === "k" &&
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey
      ) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Listen for custom event from top bar button
  useEffect(() => {
    function onCustom() {
      setOpen(true);
    }
    window.addEventListener("open-command-palette", onCustom);
    return () => window.removeEventListener("open-command-palette", onCustom);
  }, []);

  const value: CommandPaletteContextValue = {
    open,
    setOpen,
    commands,
    registerCommands,
    recentIds,
    addRecent,
  };

  return React.createElement(
    CommandPaletteContext.Provider,
    { value },
    children,
  );
}

export function useCommandPalette() {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) {
    throw new Error(
      "useCommandPalette must be used within a CommandPaletteProvider",
    );
  }
  return ctx;
}
