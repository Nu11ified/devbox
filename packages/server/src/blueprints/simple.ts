import type { AgentBackend, TaskSpec, RunResult } from "@patchwork/shared";
import type { SidecarClient } from "../agents/backend.js";
import type { BlueprintRunner } from "./runner.js";
import { agentLoop } from "../agents/loop.js";
import { collectPatches } from "../patchwork/collector.js";
import { PatchStore } from "../patchwork/store.js";
import { PatchMerger } from "../patchwork/merger.js";

function buildImplementerContext(taskSpec: TaskSpec): string {
  return `You are an implementer agent. Your job is to implement the following task:

${taskSpec.description}

Repository: ${taskSpec.repo}
Branch: ${taskSpec.branch}

Write clean, well-tested code. When done, ensure all changes are saved.`;
}

function buildReviewerContext(taskSpec: TaskSpec): string {
  return `You are a code reviewer. Review the changes made for the following task:

${taskSpec.description}

Repository: ${taskSpec.repo}
Branch: ${taskSpec.branch}

Check for bugs, security issues, and code quality problems. Only read files — do not modify anything.`;
}

/**
 * Simple 3-step blueprint: implement -> lint -> review
 *
 * This is the basic workflow that implements a task, lints the result,
 * and runs a review pass.
 *
 * Note: All sidecar calls are remote HTTP requests to the sidecar service
 * running inside the devbox container — not local process execution.
 */
export async function runSimpleBlueprint(
  runner: BlueprintRunner,
  runId: string,
  taskSpec: TaskSpec,
  agentBackend: AgentBackend,
  sidecar: SidecarClient,
  storePath?: string
): Promise<RunResult> {
  const patchStore = new PatchStore(storePath);

  // Step 1: Implement (agent)
  await runner.updateRunStatus(runId, "running");

  const implStep = await runner.createStep(runId, "implement", "agent", "implementer");
  const implSession = await agentBackend.startSession(runId, {
    role: "implementer",
    budget: { maxTimeSeconds: 300 },
    allowedTools: ["shell", "file_read", "file_write"],
    systemContext: buildImplementerContext(taskSpec),
  });
  await agentBackend.sendTask(implSession, taskSpec.description);
  const implResult = await agentLoop({
    session: implSession,
    events: agentBackend.events(implSession),
    sidecar,
    config: implSession.config,
    recordEvent: runner.recordEvent.bind(runner),
    collectPatches: () => collectPatches(sidecar, runId, implStep.id, "implementer"),
  });
  await runner.completeStep(implStep.id, implResult);

  // Step 2: Lint (deterministic) — runs via sidecar HTTP endpoint
  const lintStep = await runner.createStep(runId, "lint", "deterministic");
  const lintResult = await sidecar.exec("npm", ["run", "lint"]);
  await runner.completeStep(lintStep.id, { exitCode: lintResult.exitCode });

  // Step 3: Review (agent)
  const reviewStep = await runner.createStep(runId, "review", "agent", "reviewer");
  const reviewSession = await agentBackend.startSession(runId, {
    role: "reviewer",
    budget: { maxTimeSeconds: 120 },
    allowedTools: ["file_read"],
    systemContext: buildReviewerContext(taskSpec),
  });
  await agentBackend.sendTask(reviewSession, `Review the implementation of: ${taskSpec.description}`);
  const reviewResult = await agentLoop({
    session: reviewSession,
    events: agentBackend.events(reviewSession),
    sidecar,
    config: reviewSession.config,
    recordEvent: runner.recordEvent.bind(runner),
    collectPatches: () => collectPatches(sidecar, runId, reviewStep.id, "reviewer"),
  });
  await runner.completeStep(reviewStep.id, reviewResult);

  // Merge all patches
  const merger = new PatchMerger();
  const mergeResult = await merger.mergeAndCommit(sidecar, runId, patchStore);

  const finalStatus = mergeResult.success ? "completed" : "failed";
  await runner.updateRunStatus(runId, finalStatus);

  return { runId, status: finalStatus, sha: mergeResult.sha };
}
