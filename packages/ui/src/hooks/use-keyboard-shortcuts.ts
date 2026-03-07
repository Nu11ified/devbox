"use client";

import { useEffect } from "react";

export interface ShortcutConfig {
  key: string;
  meta?: boolean;
  shift?: boolean;
  handler: () => void;
  description: string;
}

export function useKeyboardShortcuts(shortcuts: ShortcutConfig[]) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      for (const shortcut of shortcuts) {
        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();
        const metaMatch = shortcut.meta
          ? e.metaKey || e.ctrlKey
          : !e.metaKey && !e.ctrlKey;
        const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey;

        if (keyMatch && metaMatch && shiftMatch) {
          // Allow Cmd+Enter while typing, block all other shortcuts
          if (isTyping && !(shortcut.meta && shortcut.key === "Enter")) {
            return;
          }
          e.preventDefault();
          shortcut.handler();
          return;
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcuts]);
}
