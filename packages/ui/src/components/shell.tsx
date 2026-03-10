"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TopBar } from "@/components/top-bar";
import { CommandPalette } from "@/components/command-palette";
import {
  CommandPaletteProvider,
  useCommandPalette,
} from "@/hooks/use-command-palette";
import { api } from "@/lib/api";
import {
  LayoutGrid,
  Puzzle,
  Settings,
  FolderOpen,
  Plus,
} from "lucide-react";

function ShellCommands() {
  const router = useRouter();
  const { registerCommands } = useCommandPalette();

  useEffect(() => {
    const unregister = registerCommands([
      {
        id: "nav-board",
        label: "Go to Board",
        group: "Navigation",
        icon: LayoutGrid,
        shortcut: "",
        onSelect: () => router.push("/board"),
      },
      {
        id: "nav-plugins",
        label: "Go to Plugins",
        group: "Navigation",
        icon: Puzzle,
        shortcut: "",
        onSelect: () => router.push("/plugins"),
      },
      {
        id: "nav-settings",
        label: "Go to Settings",
        group: "Navigation",
        icon: Settings,
        shortcut: "",
        onSelect: () => router.push("/settings"),
      },
      {
        id: "nav-projects",
        label: "Go to Projects",
        group: "Navigation",
        icon: FolderOpen,
        shortcut: "",
        onSelect: () => router.push("/projects"),
      },
      {
        id: "action-new-project",
        label: "New Project",
        group: "Actions",
        icon: Plus,
        shortcut: "\u2318\u21e7N",
        onSelect: () => router.push("/projects/new"),
      },
    ]);
    return unregister;
  }, [registerCommands, router]);

  return null;
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/login";
  const isOnboarding = pathname === "/onboarding";
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Skip onboarding check for login and onboarding pages
    if (isLogin || isOnboarding) {
      setChecked(true);
      return;
    }

    api.getOnboardingStatus()
      .then((status) => {
        if (!status.completed) {
          router.push("/onboarding");
        }
        setChecked(true);
      })
      .catch(() => {
        // If the check fails (e.g., not authenticated yet), just show the page
        setChecked(true);
      });
  }, [isLogin, isOnboarding, router]);

  if (isLogin || isOnboarding) {
    return <>{children}</>;
  }

  if (!checked) {
    return null; // Brief loading state while checking onboarding
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <TopBar />
      <CommandPalette />
      <ShellCommands />
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <CommandPaletteProvider>
      <ShellInner>{children}</ShellInner>
    </CommandPaletteProvider>
  );
}
