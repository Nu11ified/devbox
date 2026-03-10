"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { ProjectSidebar } from "@/components/project-sidebar";

export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { projectId } = useParams<{ projectId: string }>();
  const [collapsed, setCollapsed] = useState(false);

  const toggle = useCallback(() => setCollapsed((v) => !v), []);

  // Cmd+B to toggle sidebar
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (
        e.key.toLowerCase() === "b" &&
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey
      ) {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  return (
    <div className="flex h-full overflow-hidden">
      <ProjectSidebar
        projectId={projectId}
        collapsed={collapsed}
        onToggle={toggle}
      />
      <div className="flex-1 min-w-0 overflow-hidden">{children}</div>
    </div>
  );
}
