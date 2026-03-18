export type CycleEvent =
  | { type: "cycle.started"; blueprintId: string; runId: string; blueprintName: string }
  | { type: "cycle.completed"; runId: string; status: string; durationMs: number }
  | { type: "cycle.failed"; runId: string; nodeId: string; reason: string }
  | { type: "phase.started"; nodeId: string; nodeName: string; nodeType: "agentic" | "deterministic"; index: number; total: number }
  | { type: "phase.completed"; nodeId: string; status: string }
  | { type: "phase.skipped"; nodeId: string; reason: string }
  | { type: "gate.running"; checkType: string; language: string }
  | { type: "gate.result"; checkType: string; passed: boolean; summary: string; details?: string; errorCount?: number; warningCount?: number };
