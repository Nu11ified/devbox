"use client";

interface CycleStatusBarProps {
  blueprintName: string;
  nodes: Array<{
    id: string;
    name: string;
    status: "pending" | "running" | "passed" | "failed" | "skipped";
  }>;
  currentIndex: number;
  status: "running" | "completed" | "gate_failed" | "failed";
  durationMs?: number;
}

export function CycleStatusBar({
  blueprintName,
  nodes,
  currentIndex,
  status,
  durationMs,
}: CycleStatusBarProps) {
  if (status === "completed" || status === "failed") {
    // Show completed state — compact summary
    return (
      <div className="border-b border-zinc-800 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-zinc-400">{blueprintName}</span>
          <span
            className={`text-xs font-mono ${
              status === "completed" ? "text-green-400" : "text-red-400"
            }`}
          >
            {status === "completed" ? "✓ Completed" : "✗ Failed"}
          </span>
          {durationMs && (
            <span className="text-xs font-mono text-zinc-500">
              {Math.round(durationMs / 1000)}s
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {nodes.map((node) => (
            <div
              key={node.id}
              title={`${node.name}: ${node.status}`}
              className={`w-2 h-2 rounded-full ${
                node.status === "passed"
                  ? "bg-green-500"
                  : node.status === "failed"
                    ? "bg-red-500"
                    : node.status === "skipped"
                      ? "bg-zinc-600"
                      : "bg-zinc-700"
              }`}
            />
          ))}
        </div>
      </div>
    );
  }

  const currentNode = nodes[currentIndex];

  return (
    <div className="border-b border-zinc-800 px-4 py-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-mono text-zinc-400">{blueprintName}</span>
        <span className="text-xs font-mono text-zinc-300">
          {currentNode?.name} ({currentIndex + 1}/{nodes.length})
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        {nodes.map((node, i) => (
          <div key={node.id} className="flex items-center gap-1.5">
            <div
              title={node.name}
              className={`w-2 h-2 rounded-full transition-colors ${
                node.status === "passed"
                  ? "bg-green-500"
                  : node.status === "running"
                    ? "bg-blue-400 animate-pulse"
                    : node.status === "failed"
                      ? "bg-red-500"
                      : node.status === "skipped"
                        ? "bg-zinc-600"
                        : "bg-zinc-700"
              }`}
            />
            {i < nodes.length - 1 && (
              <div
                className={`w-3 h-px ${
                  node.status === "passed" ? "bg-green-500/30" : "bg-zinc-700"
                }`}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
