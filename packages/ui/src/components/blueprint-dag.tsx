"use client";

import { useMemo } from "react";
import type {
  BlueprintDefinition,
  BlueprintNode,
  BlueprintEdge,
} from "@patchwork/shared";
import { cn } from "@/lib/utils";

type NodeState = "pending" | "running" | "completed" | "failed";

interface DagProps {
  blueprint: BlueprintDefinition;
  nodeStates?: Record<string, NodeState>;
  onNodeClick?: (nodeId: string) => void;
}

interface LayoutNode {
  node: BlueprintNode;
  x: number;
  y: number;
  col: number;
  row: number;
}

const NODE_W = 140;
const NODE_H = 40;
const COL_GAP = 60;
const ROW_GAP = 30;
const PADDING = 20;

function topologicalSort(
  nodes: BlueprintNode[],
  edges: BlueprintEdge[]
): BlueprintNode[] {
  const adj = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  for (const n of nodes) {
    adj.set(n.id, []);
    inDeg.set(n.id, 0);
  }
  for (const e of edges) {
    adj.get(e.from)?.push(e.to);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
  }
  const queue: string[] = [];
  for (const [id, deg] of inDeg) {
    if (deg === 0) queue.push(id);
  }
  const sorted: BlueprintNode[] = [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodeMap.get(id);
    if (node) sorted.push(node);
    for (const to of adj.get(id) ?? []) {
      const d = (inDeg.get(to) ?? 1) - 1;
      inDeg.set(to, d);
      if (d === 0) queue.push(to);
    }
  }
  // Add any remaining nodes (cycles)
  for (const n of nodes) {
    if (!sorted.find((s) => s.id === n.id)) sorted.push(n);
  }
  return sorted;
}

function layoutNodes(
  nodes: BlueprintNode[],
  edges: BlueprintEdge[]
): LayoutNode[] {
  const sorted = topologicalSort(nodes, edges);
  const depth = new Map<string, number>();

  // Compute depth (column)
  for (const n of sorted) {
    const parents = edges
      .filter((e) => e.to === n.id)
      .map((e) => depth.get(e.from) ?? 0);
    depth.set(n.id, parents.length > 0 ? Math.max(...parents) + 1 : 0);
  }

  // Group by column, assign rows
  const cols = new Map<number, BlueprintNode[]>();
  for (const n of sorted) {
    const col = depth.get(n.id) ?? 0;
    if (!cols.has(col)) cols.set(col, []);
    cols.get(col)!.push(n);
  }

  const layout: LayoutNode[] = [];
  for (const [col, colNodes] of cols) {
    colNodes.forEach((node, row) => {
      layout.push({
        node,
        col,
        row,
        x: PADDING + col * (NODE_W + COL_GAP),
        y: PADDING + row * (NODE_H + ROW_GAP),
      });
    });
  }

  return layout;
}

const stateStyles: Record<NodeState, string> = {
  pending: "stroke-muted-foreground/40 fill-background",
  running: "stroke-blue-500 fill-blue-500/10",
  completed: "stroke-green-500 fill-green-500/10",
  failed: "stroke-red-500 fill-red-500/10",
};

const stateTextColors: Record<NodeState, string> = {
  pending: "fill-muted-foreground",
  running: "fill-blue-600 dark:fill-blue-400",
  completed: "fill-green-600 dark:fill-green-400",
  failed: "fill-red-600 dark:fill-red-400",
};

export function BlueprintDag({ blueprint, nodeStates = {}, onNodeClick }: DagProps) {
  const layoutResult = useMemo(
    () => layoutNodes(blueprint.nodes, blueprint.edges),
    [blueprint.nodes, blueprint.edges]
  );

  const nodePositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const ln of layoutResult) {
      map.set(ln.node.id, { x: ln.x, y: ln.y });
    }
    return map;
  }, [layoutResult]);

  const maxX = Math.max(...layoutResult.map((n) => n.x)) + NODE_W + PADDING;
  const maxY = Math.max(...layoutResult.map((n) => n.y)) + NODE_H + PADDING;
  const svgW = Math.max(maxX, 200);
  const svgH = Math.max(maxY, 80);

  return (
    <div className="overflow-x-auto">
      <svg width={svgW} height={svgH} className="block">
        {/* Edges */}
        {blueprint.edges.map((edge) => {
          const from = nodePositions.get(edge.from);
          const to = nodePositions.get(edge.to);
          if (!from || !to) return null;
          const x1 = from.x + NODE_W;
          const y1 = from.y + NODE_H / 2;
          const x2 = to.x;
          const y2 = to.y + NODE_H / 2;

          // Detect loop edge (to comes before from in layout)
          const isLoop = (to.x <= from.x);

          if (isLoop) {
            const cy = Math.max(y1, y2) + NODE_H + 10;
            return (
              <path
                key={`${edge.from}-${edge.to}`}
                d={`M${x1},${y1} C${x1 + 30},${cy} ${x2 - 30},${cy} ${x2},${y2}`}
                className="stroke-muted-foreground/50"
                fill="none"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                markerEnd="url(#arrowhead)"
              />
            );
          }

          const mx = (x1 + x2) / 2;
          return (
            <path
              key={`${edge.from}-${edge.to}`}
              d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
              className="stroke-muted-foreground/50"
              fill="none"
              strokeWidth={1.5}
              markerEnd="url(#arrowhead)"
            />
          );
        })}

        {/* Arrow marker */}
        <defs>
          <marker
            id="arrowhead"
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <polygon
              points="0 0, 8 3, 0 6"
              className="fill-muted-foreground/50"
            />
          </marker>
        </defs>

        {/* Nodes */}
        {layoutResult.map((ln) => {
          const state = nodeStates[ln.node.id] ?? "pending";
          const isAgent = ln.node.type === "agent";
          const rx = isAgent ? 16 : 4;

          return (
            <g
              key={ln.node.id}
              className={cn("cursor-pointer", state === "running" && "animate-pulse")}
              onClick={() => onNodeClick?.(ln.node.id)}
            >
              <rect
                x={ln.x}
                y={ln.y}
                width={NODE_W}
                height={NODE_H}
                rx={rx}
                ry={rx}
                strokeWidth={2}
                className={stateStyles[state]}
              />
              <text
                x={ln.x + NODE_W / 2}
                y={ln.y + NODE_H / 2}
                textAnchor="middle"
                dominantBaseline="central"
                className={cn("text-[11px] font-medium", stateTextColors[state])}
              >
                {ln.node.label.length > 16
                  ? ln.node.label.slice(0, 14) + "..."
                  : ln.node.label}
              </text>
              {state === "completed" && (
                <text
                  x={ln.x + NODE_W - 8}
                  y={ln.y + 10}
                  textAnchor="middle"
                  className="text-[10px] fill-green-500"
                >
                  ✓
                </text>
              )}
              {state === "failed" && (
                <text
                  x={ln.x + NODE_W - 8}
                  y={ln.y + 10}
                  textAnchor="middle"
                  className="text-[10px] fill-red-500"
                >
                  ✗
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
