import type { AgentEvent, RunStatus } from "@patchwork/shared";
import { randomUUID } from "node:crypto";

export interface StepRecord {
  id: string;
  runId: string;
  nodeId: string;
  nodeType: string;
  agentRole?: string;
  status: string;
  startedAt: Date;
  endedAt?: Date;
  durationMs?: number;
  output?: unknown;
}

export interface TranscriptRecord {
  id: string;
  runId: string;
  stepId?: string;
  eventType: string;
  content: unknown;
  createdAt: Date;
}

/**
 * BlueprintRunner manages execution context for a blueprint run.
 * Tracks steps, status, and transcript events in memory.
 * In production this would persist to PostgreSQL via getPool().
 */
export class BlueprintRunner {
  private steps = new Map<string, StepRecord>();
  private runStatuses = new Map<string, RunStatus>();
  private events = new Map<string, TranscriptRecord[]>();

  async createStep(
    runId: string,
    nodeId: string,
    nodeType: string,
    agentRole?: string
  ): Promise<StepRecord> {
    const step: StepRecord = {
      id: randomUUID(),
      runId,
      nodeId,
      nodeType,
      agentRole,
      status: "running",
      startedAt: new Date(),
    };
    this.steps.set(step.id, step);
    return step;
  }

  async completeStep(stepId: string, output: unknown): Promise<StepRecord> {
    const step = this.steps.get(stepId);
    if (!step) {
      throw new Error(`Step ${stepId} not found`);
    }
    step.status = "completed";
    step.output = output;
    step.endedAt = new Date();
    step.durationMs = step.endedAt.getTime() - step.startedAt.getTime();
    return step;
  }

  async updateRunStatus(runId: string, status: RunStatus): Promise<void> {
    this.runStatuses.set(runId, status);
  }

  getRunStatus(runId: string): RunStatus | undefined {
    return this.runStatuses.get(runId);
  }

  async recordEvent(runId: string, event: AgentEvent): Promise<void> {
    const record: TranscriptRecord = {
      id: randomUUID(),
      runId,
      eventType: event.type,
      content: event,
      createdAt: new Date(),
    };
    const existing = this.events.get(runId) || [];
    existing.push(record);
    this.events.set(runId, existing);
  }

  getEvents(runId: string): TranscriptRecord[] {
    return this.events.get(runId) || [];
  }

  getSteps(runId: string): StepRecord[] {
    return Array.from(this.steps.values()).filter((s) => s.runId === runId);
  }
}
