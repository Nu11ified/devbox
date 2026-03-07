"use client";

import { useState } from "react";
import { FileEdit, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DiffFile {
  path: string;
  status: "added" | "modified" | "deleted";
  hunks: Array<{
    header: string;
    lines: Array<{ type: "add" | "remove" | "context"; content: string }>;
  }>;
}

interface DiffPanelProps {
  files: DiffFile[];
  open: boolean;
  onClose: () => void;
}

export function DiffPanel({ files, open, onClose }: DiffPanelProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(
    files[0]?.path ?? null
  );

  if (!open) return null;

  const currentFile = files.find((f) => f.path === selectedFile);

  return (
    <div className="border-l border-border/40 flex flex-col bg-background" style={{ width: 480 }}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
        <span className="text-xs font-medium">
          Changes ({files.length} file{files.length !== 1 ? "s" : ""})
        </span>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="border-b border-border/40 max-h-32 overflow-y-auto">
        {files.map((file) => (
          <button
            key={file.path}
            onClick={() => setSelectedFile(file.path)}
            className={cn(
              "flex items-center gap-2 w-full px-3 py-1.5 text-xs font-mono hover:bg-muted/30",
              selectedFile === file.path && "bg-muted/50"
            )}
          >
            <FileEdit className="h-3 w-3 text-muted-foreground/40" />
            <span className="truncate">{file.path}</span>
            <span
              className={cn(
                "text-[10px] ml-auto",
                file.status === "added" && "text-green-500",
                file.status === "deleted" && "text-red-500",
                file.status === "modified" && "text-amber-500"
              )}
            >
              {file.status}
            </span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {currentFile ? (
          <div className="font-mono text-xs">
            {currentFile.hunks.map((hunk, i) => (
              <div key={i}>
                <div className="bg-muted/30 px-3 py-1 text-muted-foreground/60 sticky top-0">
                  {hunk.header}
                </div>
                {hunk.lines.map((line, j) => (
                  <div
                    key={j}
                    className={cn(
                      "px-3 py-0.5 whitespace-pre",
                      line.type === "add" && "bg-green-500/10 text-green-700 dark:text-green-400",
                      line.type === "remove" && "bg-red-500/10 text-red-700 dark:text-red-400"
                    )}
                  >
                    <span className="select-none text-muted-foreground/30 mr-2">
                      {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
                    </span>
                    {line.content}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground/40 text-xs">
            Select a file to view changes
          </div>
        )}
      </div>
    </div>
  );
}
