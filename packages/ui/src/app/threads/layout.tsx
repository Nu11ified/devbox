"use client";

import { useMemo, useState, useEffect } from "react";
import { ThreadSidebar } from "@/components/thread/sidebar";
import {
  useKeyboardShortcuts,
  type ShortcutConfig,
} from "@/hooks/use-keyboard-shortcuts";

export default function ThreadsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  // Listen for toggle-sidebar events from global shortcuts
  useEffect(() => {
    function onToggleSidebar() {
      setCollapsed((c) => !c);
    }
    window.addEventListener("toggle-sidebar", onToggleSidebar);
    return () => window.removeEventListener("toggle-sidebar", onToggleSidebar);
  }, []);

  // Only keep layout-specific shortcuts that are NOT handled globally
  const shortcuts = useMemo<ShortcutConfig[]>(
    () => [
      {
        key: "Escape",
        handler: () =>
          window.dispatchEvent(new CustomEvent("close-panels")),
        description: "Close panels",
      },
    ],
    [],
  );

  useKeyboardShortcuts(shortcuts);

  return (
    <div className="flex h-full">
      <ThreadSidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
      />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
