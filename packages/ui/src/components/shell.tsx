"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TopBar } from "@/components/top-bar";
import { CommandPalette } from "@/components/command-palette";
import {
  CommandPaletteProvider,
  useCommandPalette,
} from "@/hooks/use-command-palette";
import { ToastProvider } from "@/components/ui/toast";
import { useGlobalShortcuts } from "@/hooks/use-global-shortcuts";
import { api } from "@/lib/api";
import {
  LayoutGrid,
  Puzzle,
  Settings,
  FolderOpen,
  Plus,
  GitBranch,
  Users,
} from "lucide-react";
import type { ProjectItem, TeamItem } from "@/lib/api";

function ShellCommands() {
  const router = useRouter();
  const { registerCommands } = useCommandPalette();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [teams, setTeams] = useState<Array<TeamItem & { projectId: string }>>([]);

  // Fetch projects for dynamic command palette entries
  useEffect(() => {
    api.listProjects().then((ps) => {
      setProjects(ps);
      // Fetch teams for each project and flatten
      Promise.all(
        ps.map((p) =>
          api.listTeams(p.id)
            .then((ts) => ts.map((t) => ({ ...t, projectId: p.id })))
            .catch(() => [] as Array<TeamItem & { projectId: string }>)
        )
      ).then((nested) => setTeams(nested.flat())).catch(() => {});
    }).catch(() => {});
  }, []);

  // Static commands
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

  // Dynamic project navigation commands
  useEffect(() => {
    if (projects.length === 0) return;
    const cmds = projects.map((p) => ({
      id: `project-${p.id}`,
      label: `${p.name}`,
      group: "Navigation" as const,
      icon: GitBranch,
      shortcut: "",
      onSelect: () => router.push(`/projects/${p.id}`),
    }));
    return registerCommands(cmds);
  }, [projects, registerCommands, router]);

  // Dynamic team navigation commands
  useEffect(() => {
    if (teams.length === 0) return;
    const cmds = teams.map((t) => ({
      id: `team-${t.id}`,
      label: `Team: ${t.name}`,
      group: "Navigation" as const,
      icon: Users,
      shortcut: "",
      onSelect: () => router.push(`/projects/${t.projectId}/teams/${t.id}`),
    }));
    return registerCommands(cmds);
  }, [teams, registerCommands, router]);

  return null;
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === "/login";
  const isOnboarding = pathname === "/onboarding";
  const [checked, setChecked] = useState(false);

  // Hooks must be called unconditionally (before any returns)
  useGlobalShortcuts();

  useEffect(() => {
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
        setChecked(true);
      });
  }, [isLogin, isOnboarding, router]);

  if (isLogin || isOnboarding) {
    return <>{children}</>;
  }

  if (!checked) {
    return null;
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <TopBar />
      <CommandPalette />
      <ShellCommands />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <CommandPaletteProvider>
      <ToastProvider>
        <ShellInner>{children}</ShellInner>
      </ToastProvider>
    </CommandPaletteProvider>
  );
}
