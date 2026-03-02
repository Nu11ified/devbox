"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Wifi, WifiOff } from "lucide-react";
import { api } from "@/lib/api";
import type { RunDetail, TranscriptEvent } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { useRunStream } from "@/hooks/use-run-stream";
import { StatusBadge } from "@/components/status-badge";
import { TranscriptFeed } from "@/components/transcript-feed";
import { DiffViewer } from "@/components/diff-viewer";
import { FileList, type FileChange } from "@/components/file-list";
import { BlueprintDag } from "@/components/blueprint-dag";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import type { RunStatus, BlueprintDefinition } from "@patchwork/shared";

function parseDiffFiles(diff: string): FileChange[] {
  const files: FileChange[] = [];
  const lines = diff.split("\n");
  let currentPath: string | null = null;
  let additions = 0;
  let deletions = 0;

  for (const line of lines) {
    const fileMatch = line.match(/^diff --git a\/.+ b\/(.+)/);
    if (fileMatch) {
      if (currentPath) {
        files.push({ path: currentPath, additions, deletions });
      }
      currentPath = fileMatch[1];
      additions = 0;
      deletions = 0;
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  if (currentPath) {
    files.push({ path: currentPath, additions, deletions });
  }
  return files;
}

function computeDuration(run: RunDetail): string {
  const start = new Date(run.createdAt).getTime();
  const end = run.updatedAt ? new Date(run.updatedAt).getTime() : Date.now();
  const secs = Math.floor((end - start) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remainSecs}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const { data: run, loading, error } = useApi(() => api.getRun(id), [id]);
  const { data: diff } = useApi(() => api.getRunDiff(id), [id]);
  const { data: transcript } = useApi(
    () => api.getRunTranscript(id),
    [id]
  );
  const { data: blueprint } = useApi(
    () => (run?.blueprintId ? api.getBlueprint(run.blueprintId).catch(() => null) : Promise.resolve(null)),
    [run?.blueprintId]
  );

  const { events: streamEvents, isConnected } = useRunStream(id);

  // Merge initial transcript with live stream events
  const allEvents: TranscriptEvent[] = useMemo(() => {
    const initial = transcript?.events ?? [];
    const initialIds = new Set(initial.map((e) => e.id));
    const newEvents = streamEvents.filter((e) => !initialIds.has(e.id));
    return [...initial, ...newEvents];
  }, [transcript?.events, streamEvents]);

  // Compute run status from stream events (live updates)
  const liveStatus: RunStatus | undefined = useMemo(() => {
    for (let i = streamEvents.length - 1; i >= 0; i--) {
      const e = streamEvents[i];
      if (e.type === "blueprint_transition") {
        try {
          const data = JSON.parse(e.content);
          if (data.status) return data.status as RunStatus;
        } catch {
          // ignore parse errors
        }
      }
    }
    return undefined;
  }, [streamEvents]);

  const currentStatus = liveStatus ?? run?.status;

  // Node states for DAG from stream events
  const nodeStates = useMemo(() => {
    const states: Record<string, "pending" | "running" | "completed" | "failed"> = {};
    for (const e of streamEvents) {
      if (e.type === "blueprint_transition") {
        try {
          const data = JSON.parse(e.content);
          if (data.nodeId && data.nodeStatus) {
            states[data.nodeId] = data.nodeStatus;
          }
        } catch {
          // ignore parse errors
        }
      }
    }
    // Also compute from run steps if available
    if (run?.steps) {
      for (const step of run.steps) {
        if (!states[step.nodeId]) {
          states[step.nodeId] = step.status as "pending" | "running" | "completed" | "failed";
        }
      }
    }
    return states;
  }, [streamEvents, run?.steps]);

  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const diffFiles = useMemo(() => parseDiffFiles(diff ?? ""), [diff]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading run...
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-destructive">
        <p>Failed to load run{error ? `: ${error.message}` : ""}</p>
        <Button asChild variant="outline">
          <Link href="/runs">Back to Runs</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border p-3 md:p-4">
        <Button asChild variant="ghost" size="icon" className="shrink-0">
          <Link href="/runs">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex flex-1 flex-wrap items-center gap-2 min-w-0">
          {currentStatus && <StatusBadge status={currentStatus} />}
          <span className="text-sm font-medium truncate">{run.repo}</span>
          <span className="text-xs text-muted-foreground">{run.branch}</span>
          <span className="text-xs text-muted-foreground">
            {run.backend || "auto"}
          </span>
          <span className="text-xs text-muted-foreground">
            {computeDuration(run)}
          </span>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
          {isConnected ? (
            <Wifi className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <WifiOff className="h-3.5 w-3.5 text-yellow-500" />
          )}
          <span className="hidden sm:inline">
            {isConnected ? "Live" : "Connecting..."}
          </span>
        </div>
      </div>

      {/* Body — Mobile: single tabbed view. Desktop: split pane */}

      {/* Mobile: fully tabbed layout */}
      <div className="flex flex-1 flex-col overflow-hidden md:hidden">
        <Tabs defaultValue="transcript" className="flex flex-1 flex-col overflow-hidden">
          <TabsList className="mx-2 mt-2 w-auto shrink-0 grid grid-cols-4">
            <TabsTrigger value="transcript" className="text-xs">Transcript</TabsTrigger>
            <TabsTrigger value="diffs" className="text-xs">Diffs</TabsTrigger>
            <TabsTrigger value="dag" className="text-xs">DAG</TabsTrigger>
            <TabsTrigger value="meta" className="text-xs">Meta</TabsTrigger>
          </TabsList>

          <TabsContent value="transcript" className="flex-1 overflow-hidden m-0 mt-2">
            <TranscriptFeed events={allEvents} isConnected={isConnected} />
          </TabsContent>

          <TabsContent value="diffs" className="flex-1 overflow-hidden m-0 mt-2">
            <div className="flex h-full flex-col">
              <div className="w-full border-b shrink-0 overflow-auto max-h-32">
                <FileList
                  files={diffFiles}
                  selectedFile={selectedFile}
                  onSelect={setSelectedFile}
                />
              </div>
              <div className="flex-1 min-h-[250px]">
                <DiffViewer diff={diff ?? ""} filePath={selectedFile} />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="dag" className="flex-1 overflow-auto m-0 mt-2 p-4">
            {blueprint ? (
              <BlueprintDag blueprint={blueprint} nodeStates={nodeStates} />
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No blueprint data available
              </div>
            )}
          </TabsContent>

          <TabsContent value="meta" className="flex-1 overflow-auto m-0 mt-2 p-4">
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-muted-foreground">Run ID:</span>{" "}
                <span className="font-mono text-xs break-all">{run.id}</span>
              </div>
              <Separator />
              <div>
                <span className="text-muted-foreground">Blueprint:</span>{" "}
                {run.blueprintId}
              </div>
              <Separator />
              <div>
                <span className="text-muted-foreground">Description:</span>
                <p className="mt-1">{run.description}</p>
              </div>
              <Separator />
              <div>
                <span className="text-muted-foreground">Created:</span>{" "}
                {new Date(run.createdAt).toLocaleString()}
              </div>
              {run.patches && run.patches.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <span className="text-muted-foreground">Patches:</span>
                    <div className="mt-1 space-y-2">
                      {run.patches.map((patch) => (
                        <div
                          key={patch.id}
                          className="rounded-md border border-border p-2 text-xs"
                        >
                          <span className="font-medium">{patch.agentRole}</span>
                          <span className="text-muted-foreground ml-2">
                            {patch.files.length} file(s)
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
              {run.steps && run.steps.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <span className="text-muted-foreground">Steps:</span>
                    <div className="mt-1 space-y-1">
                      {run.steps.map((step) => (
                        <div
                          key={step.id}
                          className="flex items-center gap-2 text-xs"
                        >
                          <span className="font-medium">{step.nodeId}</span>
                          <span className="text-muted-foreground">
                            {step.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Desktop: split pane */}
      <div className="hidden md:flex flex-1 flex-row overflow-hidden">
        {/* Left: Transcript */}
        <div className="flex-1 overflow-hidden border-r border-border min-h-0">
          <TranscriptFeed events={allEvents} isConnected={isConnected} />
        </div>

        {/* Right: Tabs */}
        <div className="flex flex-1 flex-col overflow-hidden max-w-[50%]">
          <Tabs defaultValue="diffs" className="flex flex-1 flex-col overflow-hidden">
            <TabsList className="mx-2 mt-2 w-auto shrink-0">
              <TabsTrigger value="diffs">Diffs</TabsTrigger>
              <TabsTrigger value="dag">DAG</TabsTrigger>
              <TabsTrigger value="patches">Patches</TabsTrigger>
              <TabsTrigger value="meta">Meta</TabsTrigger>
            </TabsList>

            <TabsContent value="diffs" className="flex-1 overflow-hidden m-0 mt-2">
              <div className="flex h-full flex-row">
                <div className="w-48 border-r shrink-0 overflow-auto">
                  <FileList
                    files={diffFiles}
                    selectedFile={selectedFile}
                    onSelect={setSelectedFile}
                  />
                </div>
                <div className="flex-1 min-h-[300px]">
                  <DiffViewer diff={diff ?? ""} filePath={selectedFile} />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="dag" className="flex-1 overflow-auto m-0 mt-2 p-4">
              {blueprint ? (
                <BlueprintDag blueprint={blueprint} nodeStates={nodeStates} />
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No blueprint data available
                </div>
              )}
            </TabsContent>

            <TabsContent value="patches" className="flex-1 overflow-auto m-0 mt-2 p-4">
              {run.patches && run.patches.length > 0 ? (
                <div className="space-y-2">
                  {run.patches.map((patch) => (
                    <div
                      key={patch.id}
                      className="rounded-md border border-border p-3 text-sm"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{patch.agentRole}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(patch.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {patch.files.length} file(s) changed
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No patches yet
                </div>
              )}
            </TabsContent>

            <TabsContent value="meta" className="flex-1 overflow-auto m-0 mt-2 p-4">
              <div className="space-y-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Run ID:</span>{" "}
                  <span className="font-mono text-xs">{run.id}</span>
                </div>
                <Separator />
                <div>
                  <span className="text-muted-foreground">Blueprint:</span>{" "}
                  {run.blueprintId}
                </div>
                <Separator />
                <div>
                  <span className="text-muted-foreground">Description:</span>
                  <p className="mt-1">{run.description}</p>
                </div>
                <Separator />
                <div>
                  <span className="text-muted-foreground">Created:</span>{" "}
                  {new Date(run.createdAt).toLocaleString()}
                </div>
                {run.steps && run.steps.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <span className="text-muted-foreground">Steps:</span>
                      <div className="mt-1 space-y-1">
                        {run.steps.map((step) => (
                          <div
                            key={step.id}
                            className="flex items-center gap-2 text-xs"
                          >
                            <span className="font-medium">{step.nodeId}</span>
                            <span className="text-muted-foreground">
                              {step.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
