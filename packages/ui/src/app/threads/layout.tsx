"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();

  const shortcuts = useMemo<ShortcutConfig[]>(
    () => [
      {
        key: "n",
        meta: true,
        handler: () => router.push("/threads/new"),
        description: "New thread",
      },
      {
        key: "b",
        meta: true,
        handler: () =>
          window.dispatchEvent(new CustomEvent("toggle-sidebar")),
        description: "Toggle sidebar",
      },
      {
        key: "d",
        meta: true,
        handler: () =>
          window.dispatchEvent(new CustomEvent("toggle-diff")),
        description: "Toggle diff panel",
      },
      {
        key: "t",
        meta: true,
        handler: () =>
          window.dispatchEvent(new CustomEvent("toggle-terminal")),
        description: "Toggle terminal",
      },
      {
        key: "k",
        meta: true,
        handler: () =>
          window.dispatchEvent(new CustomEvent("focus-search")),
        description: "Focus search",
      },
      {
        key: "Escape",
        handler: () =>
          window.dispatchEvent(new CustomEvent("close-panels")),
        description: "Close panels",
      },
      ...Array.from({ length: 9 }, (_, i) => ({
        key: String(i + 1),
        meta: true,
        handler: () =>
          window.dispatchEvent(
            new CustomEvent("switch-thread", { detail: { index: i + 1 } }),
          ),
        description: `Switch to thread ${i + 1}`,
      })),
    ],
    [router],
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
