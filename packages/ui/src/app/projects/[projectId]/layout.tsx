"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ProjectSidebar } from "@/components/project-sidebar";
import { useCommandPalette } from "@/hooks/use-command-palette";
import { api, type ProjectDetail } from "@/lib/api";
import { MessageSquare } from "lucide-react";

function ProjectCommands({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { registerCommands } = useCommandPalette();
  const [project, setProject] = useState<ProjectDetail | null>(null);

  useEffect(() => {
    api.getProject(projectId).then(setProject).catch(() => {});
  }, [projectId]);

  // Register dynamic thread navigation commands in Cmd+K
  useEffect(() => {
    if (!project) return;
    const cmds = project.threads.map((thread, i) => ({
      id: `thread-${thread.id}`,
      label: `${thread.title}`,
      group: "Navigation" as const,
      icon: MessageSquare,
      shortcut: i < 9 ? `⌘${i + 1}` : "",
      onSelect: () => router.push(`/projects/${projectId}/threads/${thread.id}`),
    }));
    return registerCommands(cmds);
  }, [project, projectId, registerCommands, router]);

  // Listen for switch-thread events (Cmd+1-9)
  useEffect(() => {
    if (!project) return;
    function onSwitchThread(e: Event) {
      const detail = (e as CustomEvent).detail;
      const idx = detail?.index;
      if (typeof idx === "number" && project!.threads[idx]) {
        router.push(`/projects/${projectId}/threads/${project!.threads[idx].id}`);
      }
    }
    window.addEventListener("switch-thread", onSwitchThread);
    return () => window.removeEventListener("switch-thread", onSwitchThread);
  }, [project, projectId, router]);

  // Listen for new-thread event (Cmd+N)
  useEffect(() => {
    function onNewThread() {
      router.push(`/projects/${projectId}/threads/new`);
    }
    window.addEventListener("new-thread", onNewThread);
    return () => window.removeEventListener("new-thread", onNewThread);
  }, [projectId, router]);

  return null;
}

export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { projectId } = useParams<{ projectId: string }>();
  const [collapsed, setCollapsed] = useState(false);

  const toggle = useCallback(() => setCollapsed((v) => !v), []);

  // Listen for toggle-sidebar event (Cmd+B)
  useEffect(() => {
    function onToggle() {
      toggle();
    }
    window.addEventListener("toggle-sidebar", onToggle);
    return () => window.removeEventListener("toggle-sidebar", onToggle);
  }, [toggle]);

  return (
    <div className="flex h-full overflow-hidden">
      <ProjectCommands projectId={projectId} />
      <ProjectSidebar
        projectId={projectId}
        collapsed={collapsed}
        onToggle={toggle}
      />
      <div className="flex-1 min-w-0 overflow-hidden">{children}</div>
    </div>
  );
}
