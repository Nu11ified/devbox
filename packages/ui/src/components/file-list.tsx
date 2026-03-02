"use client";

import { File } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface FileChange {
  path: string;
  additions: number;
  deletions: number;
}

export function FileList({
  files,
  selectedFile,
  onSelect,
}: {
  files: FileChange[];
  selectedFile: string | null;
  onSelect: (path: string) => void;
}) {
  if (files.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        No changed files
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-0.5 p-1">
        {files.map((file) => (
          <button
            key={file.path}
            onClick={() => onSelect(file.path)}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors w-full",
              selectedFile === file.path
                ? "bg-accent text-accent-foreground"
                : "hover:bg-accent/50 text-foreground/80"
            )}
          >
            <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate font-mono text-xs">
              {file.path}
            </span>
            <span className="flex items-center gap-1 shrink-0 text-xs">
              {file.additions > 0 && (
                <span className="text-green-600 dark:text-green-400">
                  +{file.additions}
                </span>
              )}
              {file.deletions > 0 && (
                <span className="text-red-600 dark:text-red-400">
                  -{file.deletions}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}
