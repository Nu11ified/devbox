// Agent system types

export interface AgentBackend {
  type: "claude" | "codex";
  startSession(devboxId: string, config: AgentConfig): Promise<AgentSession>;
  sendTask(session: AgentSession, prompt: string): Promise<void>;
  events(session: AgentSession): AsyncIterable<AgentEvent>;
  terminate(session: AgentSession): Promise<void>;
}

export interface AgentConfig {
  role: "implementer" | "reviewer" | "spec_writer" | "ci_fixer";
  budget: { maxTokens?: number; maxTimeSeconds: number };
  allowedTools: string[];
  systemContext: string;
}

export type AgentEvent =
  | { type: "message"; content: string }
  | { type: "tool_call"; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; tool: string; result: unknown; exitCode?: number }
  | { type: "done_marker" }
  | { type: "error"; message: string }
  | { type: "budget_exceeded"; reason: "tokens" | "time" }
  | { type: "raw_pty"; data: string; timestamp: number };

export interface AgentSession {
  id: string;
  runId: string;
  devboxId: string;
  config: AgentConfig;
  [key: string]: unknown; // Backend-specific fields
}

// Patchwork types

export interface PatchArtifact {
  id: string;
  runId: string;
  stepId: string;
  agentRole: string;
  baseSha: string;
  repo: string;
  files: string[];
  patchContent: string;
  metadata: PatchMetadata;
  createdAt: Date;
}

export interface PatchMetadata {
  intentSummary: string;
  confidence: "high" | "medium" | "low";
  risks: string[];
  followups: string[];
}

// Blueprint types

export interface BlueprintDefinition {
  id: string;
  name: string;
  version: number;
  description: string;
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
}

export interface BlueprintNode {
  id: string;
  type: "deterministic" | "agent";
  label: string;
  command?: string;
  agentConfig?: {
    preferredBackends: ("claude" | "codex")[];
    role: string;
    promptTemplate: string;
    systemContextTemplate: string;
    allowedTools: string[];
    budget: { maxTokens?: number; maxTimeSeconds: number };
  };
  retryPolicy?: { maxRetries: number; backoffMs: number };
}

export interface BlueprintEdge {
  from: string;
  to: string;
  condition: "on_success" | "on_failure" | "on_timeout" | "always";
}

// Devbox types

export interface DevboxTemplate {
  id: string;
  name: string;
  baseImage: string;
  toolBundles: string[];
  envVars: Record<string, string>;
  bootstrapScripts: string[];
  resourceLimits: {
    cpus: number;
    memoryMB: number;
    diskMB: number;
  };
  networkPolicy: "restricted" | "egress-allowed";
  repos: string[];
}

// Run types

export type RunStatus =
  | "pending"
  | "provisioning"
  | "running"
  | "waiting_ci"
  | "completed"
  | "failed"
  | "cancelled";

export interface TaskSpec {
  description: string;
  repo: string;
  branch: string;
  templateId: string;
  blueprintId: string;
  preferredBackend?: "claude" | "codex" | "auto";
  config?: Record<string, unknown>;
}

export interface RunResult {
  runId: string;
  prUrl?: string;
  status: RunStatus;
  sha?: string;
}
