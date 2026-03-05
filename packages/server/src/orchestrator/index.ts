import { getPool, findDispatchableIssues, updateIssue } from "../db/queries.js";
import { dispatchIssue } from "./dispatcher.js";

const POLL_INTERVAL_MS = parseInt(
  process.env.PATCHWORK_POLL_INTERVAL_MS || "5000",
  10
);
const MAX_CONCURRENT = parseInt(
  process.env.PATCHWORK_MAX_CONCURRENT || "5",
  10
);
const STALL_TIMEOUT_MS = parseInt(
  process.env.PATCHWORK_STALL_TIMEOUT_MS || "600000", // 10 min
  10
);
const MAX_RETRIES = 3;

interface RunningEntry {
  issueId: string;
  runId: string;
  startedAt: Date;
  promise: Promise<void>;
  settled: boolean;
}

interface RetryEntry {
  attempt: number;
  dueAt: number;
  timer: NodeJS.Timeout;
  error: string | null;
}

/**
 * Orchestrator manages the issue-to-run lifecycle.
 * Polls for queued issues, dispatches them to available slots,
 * monitors for stalls, and handles retries with exponential backoff.
 */
export class Orchestrator {
  private running = new Map<string, RunningEntry>();
  private claimed = new Set<string>();
  private retryQueue = new Map<string, RetryEntry>();
  private tickTimer: NodeJS.Timeout | null = null;
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    console.log(
      `[orchestrator] starting (poll=${POLL_INTERVAL_MS}ms, maxConcurrent=${MAX_CONCURRENT}, stallTimeout=${STALL_TIMEOUT_MS}ms)`
    );
    this.startupCleanup().then(() => {
      this.scheduleTick();
    });
  }

  stop(): void {
    this.started = false;
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    for (const entry of this.retryQueue.values()) {
      clearTimeout(entry.timer);
    }
    this.retryQueue.clear();
    console.log("[orchestrator] stopped");
  }

  private scheduleTick(): void {
    if (!this.started) return;
    this.tickTimer = setTimeout(() => {
      this.tick().finally(() => this.scheduleTick());
    }, POLL_INTERVAL_MS);
  }

  /**
   * On startup, reset stale in_progress issues whose runs are terminal,
   * and clean up orphaned devbox containers.
   */
  private async startupCleanup(): Promise<void> {
    try {
      const db = getPool();

      // Reset issues stuck in in_progress whose runs have finished
      await db.query(
        `UPDATE issues SET status = 'queued', last_error = 'Reset after server restart'
         WHERE status = 'in_progress'
           AND run_id IS NOT NULL
           AND run_id IN (
             SELECT id FROM runs WHERE status IN ('completed', 'failed', 'cancelled')
           )`
      );

      // Reset issues stuck in in_progress with no run
      await db.query(
        `UPDATE issues SET status = 'queued', last_error = 'Reset after server restart'
         WHERE status = 'in_progress' AND run_id IS NULL`
      );

      console.log("[orchestrator] startup cleanup complete");
    } catch (err) {
      console.error("[orchestrator] startup cleanup error:", err);
    }
  }

  private async tick(): Promise<void> {
    try {
      // 1. Reconcile settled runs
      await this.reconcile();

      // 2. Detect stalled sessions
      if (STALL_TIMEOUT_MS > 0) {
        await this.detectStalls();
      }

      // 3. Fetch and dispatch eligible issues
      await this.dispatchEligible();
    } catch (err) {
      console.error("[orchestrator] tick error:", err);
    }
  }

  /**
   * Check if any running dispatches have settled.
   * Update issue status based on outcome.
   */
  private async reconcile(): Promise<void> {
    for (const [key, entry] of this.running) {
      if (entry.settled) {
        this.running.delete(key);
        this.claimed.delete(entry.issueId);
      }
    }
  }

  /**
   * Detect runs that have stalled (no transcript events for > STALL_TIMEOUT_MS).
   */
  private async detectStalls(): Promise<void> {
    if (this.running.size === 0) return;

    const db = getPool();
    const runIds = Array.from(this.running.values()).map((e) => e.runId);

    for (const runId of runIds) {
      try {
        const result = await db.query(
          "SELECT MAX(created_at) AS last_event FROM transcript_events WHERE run_id = $1",
          [runId]
        );
        const lastEvent = result.rows[0]?.last_event;
        if (!lastEvent) continue;

        const staleDuration = Date.now() - new Date(lastEvent).getTime();
        if (staleDuration > STALL_TIMEOUT_MS) {
          console.log(`[orchestrator] stall detected for run ${runId} (${staleDuration}ms since last event)`);

          // Find the entry and cancel it
          for (const [key, entry] of this.running) {
            if (entry.runId === runId) {
              await db.query(
                "UPDATE runs SET status = 'failed', updated_at = now() WHERE id = $1",
                [runId]
              );
              await this.scheduleRetry(entry.issueId, "Stalled: no activity");
              entry.settled = true;
              break;
            }
          }
        }
      } catch {
        // Continue checking other runs
      }
    }
  }

  /**
   * Fetch queued issues and dispatch up to maxConcurrent slots.
   */
  private async dispatchEligible(): Promise<void> {
    if (this.running.size >= MAX_CONCURRENT) return;

    const issues = await findDispatchableIssues();
    const slotsAvailable = MAX_CONCURRENT - this.running.size;

    for (const issue of issues.slice(0, slotsAvailable)) {
      if (this.claimed.has(issue.id)) continue;

      this.claimed.add(issue.id);
      console.log(`[orchestrator] dispatching ${issue.identifier} (${issue.title})`);

      const promise = dispatchIssue(issue).catch((err) => {
        console.error(`[orchestrator] dispatch failed for ${issue.identifier}:`, err);
        this.scheduleRetry(issue.id, err instanceof Error ? err.message : String(err));
      });

      // Track settlement
      const entry: RunningEntry = {
        issueId: issue.id,
        runId: "", // Will be set once run is created
        startedAt: new Date(),
        promise,
        settled: false,
      };

      promise.then(() => {
        entry.settled = true;
      }).catch(() => {
        entry.settled = true;
      });

      this.running.set(issue.id, entry);
    }
  }

  /**
   * Schedule a retry for a failed issue with exponential backoff.
   */
  private async scheduleRetry(
    issueId: string,
    error: string
  ): Promise<void> {
    const existing = this.retryQueue.get(issueId);
    const attempt = existing ? existing.attempt + 1 : 1;

    if (attempt > MAX_RETRIES) {
      console.log(`[orchestrator] max retries (${MAX_RETRIES}) reached for issue ${issueId}`);
      await updateIssue(issueId, {
        status: "open",
        lastError: `Max retries exceeded. Last error: ${error}`,
      });
      this.retryQueue.delete(issueId);
      this.claimed.delete(issueId);
      return;
    }

    const delay = Math.min(10000 * Math.pow(2, attempt - 1), 300000);
    console.log(`[orchestrator] scheduling retry ${attempt}/${MAX_RETRIES} for ${issueId} in ${delay}ms`);

    const timer = setTimeout(async () => {
      this.retryQueue.delete(issueId);
      this.claimed.delete(issueId);
      try {
        await updateIssue(issueId, {
          status: "queued",
          retryCount: attempt,
          lastError: error,
        });
      } catch (err) {
        console.error(`[orchestrator] retry re-queue failed for ${issueId}:`, err);
      }
    }, delay);

    if (existing) {
      clearTimeout(existing.timer);
    }

    this.retryQueue.set(issueId, { attempt, dueAt: Date.now() + delay, timer, error });
  }
}
