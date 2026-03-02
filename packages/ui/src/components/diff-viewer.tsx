"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";

const DiffEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.DiffEditor),
  { ssr: false, loading: () => <DiffSkeleton /> }
);

function DiffSkeleton() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading diff editor...
    </div>
  );
}

function parseDiffContent(diff: string, filePath: string): { original: string; modified: string } {
  // Try to extract content for the specific file from unified diff
  const lines = diff.split("\n");
  const original: string[] = [];
  const modified: string[] = [];
  let inFile = false;
  let foundFile = false;

  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      if (foundFile) break; // We already found our file, stop at next file diff
      inFile = line.includes(filePath);
      if (inFile) foundFile = true;
      continue;
    }
    if (!inFile) continue;
    if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("@@")) continue;
    if (line.startsWith("-")) {
      original.push(line.slice(1));
    } else if (line.startsWith("+")) {
      modified.push(line.slice(1));
    } else {
      const content = line.startsWith(" ") ? line.slice(1) : line;
      original.push(content);
      modified.push(content);
    }
  }

  if (!foundFile) {
    // If no specific file diff found, show full diff as modified
    return { original: "", modified: diff };
  }

  return { original: original.join("\n"), modified: modified.join("\n") };
}

export function DiffViewer({
  diff,
  filePath,
}: {
  diff: string;
  filePath: string | null;
}) {
  const { original, modified } = useMemo(() => {
    if (!diff || !filePath) return { original: "", modified: "" };
    return parseDiffContent(diff, filePath);
  }, [diff, filePath]);

  if (!diff) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No diff available
      </div>
    );
  }

  if (!filePath) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a file to view changes
      </div>
    );
  }

  const ext = filePath.split(".").pop() || "";
  const languageMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    css: "css",
    html: "html",
    sql: "sql",
  };
  const language = languageMap[ext] || "plaintext";

  return (
    <DiffEditor
      original={original}
      modified={modified}
      language={language}
      theme="vs-dark"
      options={{
        readOnly: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderSideBySide: true,
        fontSize: 13,
      }}
    />
  );
}
