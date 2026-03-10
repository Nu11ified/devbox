"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function useGlobalShortcuts() {
  const router = useRouter();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      const shift = e.shiftKey;
      const key = e.key.toLowerCase();

      // Skip if typing in input (allow Cmd-prefixed shortcuts)
      const target = e.target as HTMLElement;
      const isTyping =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      if (isTyping && !meta) return;

      // Cmd+K is handled by command palette provider — skip here
      if (meta && key === "k") return;

      if (meta && shift && key === "n") {
        e.preventDefault();
        router.push("/projects/new");
        return;
      }
      if (meta && key === "b") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("toggle-sidebar"));
        return;
      }
      if (meta && key === "n") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("new-thread"));
        return;
      }
      if (meta && key === "d") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("toggle-diff"));
        return;
      }
      if (meta && key === "j") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("toggle-terminal"));
        return;
      }
      if (meta && shift && key === "p") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("create-pr"));
        return;
      }
      if (meta && key === ".") {
        e.preventDefault();
        if (shift) {
          window.dispatchEvent(new CustomEvent("deny-request"));
        } else {
          window.dispatchEvent(new CustomEvent("approve-request"));
        }
        return;
      }
      if (meta && key === "i") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("new-issue"));
        return;
      }
      // Cmd+1-9: switch threads
      if (meta && key >= "1" && key <= "9") {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent("switch-thread", {
            detail: { index: parseInt(key) - 1 },
          }),
        );
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [router]);
}
