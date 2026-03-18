import type { GateCheckType } from "./plugins/types.js";

export interface TriggerConfig {
  keywords: string[];
  issueLabels?: string[];
}

export interface GateCheck {
  type: GateCheckType;
  language: string;
  command?: string;
}

export interface Gate {
  checks: GateCheck[];
  onFail: "retry" | "block" | "notify";
}

export interface BlueprintNode {
  id: string;
  name: string;
  type: "agentic" | "deterministic";
  prompt?: string;
  tools?: string[];
  gate?: Gate;
  maxIterations?: number;
  retryFromNodeId?: string;
  skipCondition?: string;
}

export interface Blueprint {
  id: string;
  name: string;
  description: string;
  trigger: TriggerConfig;
  nodes: BlueprintNode[];
}

export interface NodeResultState {
  nodeId: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  iterations: number;
  gateResults?: Array<{
    type: string;
    passed: boolean;
    summary: string;
    details?: string;
    errorCount?: number;
    warningCount?: number;
  }>;
  startedAt?: Date;
  completedAt?: Date;
}

export interface CycleRunState {
  id: string;
  threadId: string;
  blueprintId: string;
  currentNodeIndex: number;
  status: "running" | "gate_failed" | "completed" | "failed";
  nodeResults: NodeResultState[];
  startedAt: Date;
  completedAt?: Date;
}

/** Predefined skip condition flags */
export interface SkipContext {
  isSmallTask: boolean;
  isAutonomous: boolean;
  hasExistingTests: boolean;
  hasPrDiff: boolean;
}
