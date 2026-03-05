import type { AgentEvent, RunStatus } from "@patchwork/shared";
import { BlueprintRunner, type StepRecord } from "./runner.js";
import { getPool } from "../db/queries.js";

/**
 * PersistentBlueprintRunner extends BlueprintRunner to persist all
 * execution data to PostgreSQL. This enables the WebSocket stream
 * (ws.ts) to work by writing to transcript_events, which it polls.
 */
export class PersistentBlueprintRunner extends BlueprintRunner {
  override async createStep(
    runId: string,
    nodeId: string,
    nodeType: string,
    agentRole?: string
  ): Promise<StepRecord> {
    const db = getPool();
    const result = await db.query(
      `INSERT INTO run_steps (run_id, node_id, node_type, agent_role, status, started_at)
       VALUES ($1, $2, $3, $4, 'running', now())
       RETURNING *`,
      [runId, nodeId, nodeType, agentRole || null]
    );
    const row = result.rows[0];
    return {
      id: row.id,
      runId: row.run_id,
      nodeId: row.node_id,
      nodeType: row.node_type,
      agentRole: row.agent_role || undefined,
      status: row.status,
      startedAt: new Date(row.started_at),
    };
  }

  override async completeStep(
    stepId: string,
    output: unknown
  ): Promise<StepRecord> {
    const db = getPool();
    const result = await db.query(
      `UPDATE run_steps
       SET status = 'completed',
           output = $1,
           ended_at = now(),
           duration_ms = EXTRACT(EPOCH FROM (now() - started_at)) * 1000
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify(output), stepId]
    );
    if (result.rows.length === 0) {
      throw new Error(`Step ${stepId} not found`);
    }
    const row = result.rows[0];
    return {
      id: row.id,
      runId: row.run_id,
      nodeId: row.node_id,
      nodeType: row.node_type,
      agentRole: row.agent_role || undefined,
      status: row.status,
      startedAt: new Date(row.started_at),
      endedAt: row.ended_at ? new Date(row.ended_at) : undefined,
      durationMs: row.duration_ms ?? undefined,
      output: row.output,
    };
  }

  override async updateRunStatus(
    runId: string,
    status: RunStatus
  ): Promise<void> {
    const db = getPool();
    await db.query(
      "UPDATE runs SET status = $1, updated_at = now() WHERE id = $2",
      [status, runId]
    );
  }

  override async recordEvent(
    runId: string,
    event: AgentEvent
  ): Promise<void> {
    const db = getPool();
    await db.query(
      `INSERT INTO transcript_events (run_id, event_type, content)
       VALUES ($1, $2, $3)`,
      [runId, event.type, JSON.stringify(event)]
    );
  }
}
