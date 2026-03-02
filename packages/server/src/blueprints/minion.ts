import type { AgentBackend, TaskSpec, RunResult } from "@patchwork/shared";
import type { SidecarClient } from "../agents/backend.js";
import type { BlueprintRunner } from "./runner.js";
import type { PatchStore } from "../patchwork/store.js";
import { agentLoop } from "../agents/loop.js";
import { collectPatches } from "../patchwork/collector.js";
import { PatchMerger } from "../patchwork/merger.js";
import { CIManager } from "../ci/manager.js";
import {
  buildImplementerContext,
  buildReviewerContext,
  buildLintFixerContext,
  buildCIFixerContext,
} from "./context.js";

const MAX_LINT_RETRIES = 3;
const MAX_CI_RETRIES = 1;
const CI_POLL_TIMEOUT_MS = 600_000; // 10 minutes

/**
 * Full Stripe-style minion blueprint:
 *
 * checkout → implement → lint_check → (fail? → lint_fix, max 3)
 *   → test → review → merge → push → ci_poll → (fail? → ci_fix, max 1) → done
 *
 * Each node maps to either a deterministic step or an agent step.
 *
 * Note: All sidecar calls (sidecar.exec, sidecar.gitDiff, etc.) are remote
 * HTTP requests to the sidecar service running inside the devbox container —
 * not local process execution.
 */
export async function runMinionBlueprint(
  runner: BlueprintRunner,
  runId: string,
  taskSpec: TaskSpec,
  backendFactory: (role: string) => AgentBackend,
  sidecar: SidecarClient,
  patchStore: PatchStore,
): Promise<RunResult> {
  await runner.updateRunStatus(runId, "running");

  // --- Step 1: Checkout (deterministic) ---
  const checkoutStep = await runner.createStep(runId, "checkout", "deterministic");
  await sidecar.exec("git", ["checkout", taskSpec.branch]);
  await runner.completeStep(checkoutStep.id, { branch: taskSpec.branch });

  // --- Step 2: Implement (agent) ---
  const implStep = await runner.createStep(runId, "implement", "agent", "implementer");
  const implBackend = backendFactory("implementer");
  const implSession = await implBackend.startSession(runId, {
    role: "implementer",
    budget: { maxTimeSeconds: 600 },
    allowedTools: ["file_read", "file_write", "shell", "grep", "glob"],
    systemContext: buildImplementerContext(taskSpec),
  });
  await implBackend.sendTask(implSession, taskSpec.description);
  const implResult = await agentLoop({
    session: implSession,
    events: implBackend.events(implSession),
    sidecar,
    config: implSession.config,
    recordEvent: runner.recordEvent.bind(runner),
    collectPatches: () => collectPatches(sidecar, runId, implStep.id, "implementer"),
  });
  await runner.completeStep(implStep.id, implResult);

  // --- Step 3: Lint loop (deterministic check + agent fix, max 3) ---
  let lintClean = false;
  for (let i = 0; i < MAX_LINT_RETRIES && !lintClean; i++) {
    const lintStep = await runner.createStep(runId, "lint_check", "deterministic");
    const lintResult = await sidecar.exec("npm", ["run", "lint"]);
    await runner.completeStep(lintStep.id, { exitCode: lintResult.exitCode });

    if (lintResult.exitCode === 0) {
      lintClean = true;
    } else {
      if (i < MAX_LINT_RETRIES - 1) {
        const fixStep = await runner.createStep(runId, "lint_fix", "agent", "ci_fixer");
        const fixBackend = backendFactory("ci_fixer");
        const fixSession = await fixBackend.startSession(runId, {
          role: "ci_fixer",
          budget: { maxTimeSeconds: 120 },
          allowedTools: ["file_read", "file_write"],
          systemContext: buildLintFixerContext(lintResult.stderr || lintResult.stdout),
        });
        await fixBackend.sendTask(fixSession, "Fix the lint errors");
        const fixResult = await agentLoop({
          session: fixSession,
          events: fixBackend.events(fixSession),
          sidecar,
          config: fixSession.config,
          recordEvent: runner.recordEvent.bind(runner),
          collectPatches: () => collectPatches(sidecar, runId, fixStep.id, "ci_fixer"),
        });
        await runner.completeStep(fixStep.id, fixResult);
      }
    }
  }

  if (!lintClean) {
    await runner.updateRunStatus(runId, "failed");
    return { runId, status: "failed" };
  }

  // --- Step 4: Test (deterministic) ---
  const testStep = await runner.createStep(runId, "test", "deterministic");
  const testResult = await sidecar.exec("npm", ["run", "test"]);
  await runner.completeStep(testStep.id, { exitCode: testResult.exitCode });

  // --- Step 5: Review (agent, read-only tools) ---
  const reviewStep = await runner.createStep(runId, "review", "agent", "reviewer");
  const diff = await sidecar.gitDiff();
  const reviewBackend = backendFactory("reviewer");
  const reviewSession = await reviewBackend.startSession(runId, {
    role: "reviewer",
    budget: { maxTimeSeconds: 180 },
    allowedTools: ["file_read", "grep", "glob"],
    systemContext: buildReviewerContext(taskSpec, diff),
  });
  await reviewBackend.sendTask(reviewSession, `Review the implementation of: ${taskSpec.description}`);
  const reviewResult = await agentLoop({
    session: reviewSession,
    events: reviewBackend.events(reviewSession),
    sidecar,
    config: reviewSession.config,
    recordEvent: runner.recordEvent.bind(runner),
    collectPatches: () => collectPatches(sidecar, runId, reviewStep.id, "reviewer"),
  });
  await runner.completeStep(reviewStep.id, reviewResult);

  // --- Step 6: Merge patches (deterministic) ---
  const mergeStep = await runner.createStep(runId, "merge", "deterministic");
  const merger = new PatchMerger();
  const mergeResult = await merger.mergeAndCommit(sidecar, runId, patchStore);
  await runner.completeStep(mergeStep.id, mergeResult);

  // --- Step 7: Push (deterministic) ---
  const pushStep = await runner.createStep(runId, "push", "deterministic");
  const ciManager = new CIManager(sidecar);
  const pushResult = await ciManager.pushBranch(taskSpec.branch);
  await runner.completeStep(pushStep.id, pushResult);

  // --- Step 8: CI poll (deterministic) ---
  const getSha = await sidecar.exec("git", ["rev-parse", "HEAD"]);
  const sha = getSha.stdout.trim();

  let ciResult = await pollCIStep(runner, runId, ciManager, taskSpec.repo, sha);

  // --- Step 9: CI fix loop (max 1 retry) ---
  if (ciResult.status === "failure") {
    for (let i = 0; i < MAX_CI_RETRIES; i++) {
      const ciFixStep = await runner.createStep(runId, "ci_fix", "agent", "ci_fixer");
      const ciFixBackend = backendFactory("ci_fixer");
      const ciFixSession = await ciFixBackend.startSession(runId, {
        role: "ci_fixer",
        budget: { maxTimeSeconds: 300 },
        allowedTools: ["file_read", "file_write", "shell", "grep"],
        systemContext: buildCIFixerContext(ciResult.logs || ""),
      });
      await ciFixBackend.sendTask(ciFixSession, "Fix the CI failures");
      const ciFixResult = await agentLoop({
        session: ciFixSession,
        events: ciFixBackend.events(ciFixSession),
        sidecar,
        config: ciFixSession.config,
        recordEvent: runner.recordEvent.bind(runner),
        collectPatches: () => collectPatches(sidecar, runId, ciFixStep.id, "ci_fixer"),
      });
      await runner.completeStep(ciFixStep.id, ciFixResult);

      // Re-merge, push, and poll again
      const reMergeStep = await runner.createStep(runId, "merge", "deterministic");
      const reMerge = await merger.mergeAndCommit(sidecar, runId, patchStore);
      await runner.completeStep(reMergeStep.id, reMerge);

      const rePushStep = await runner.createStep(runId, "push", "deterministic");
      const rePush = await ciManager.pushBranch(taskSpec.branch);
      await runner.completeStep(rePushStep.id, rePush);

      const newSha = (await sidecar.exec("git", ["rev-parse", "HEAD"])).stdout.trim();
      ciResult = await pollCIStep(runner, runId, ciManager, taskSpec.repo, newSha);

      if (ciResult.status === "success") break;
    }
  }

  // --- Step 10: Done ---
  const doneStep = await runner.createStep(runId, "done", "deterministic");
  const finalStatus = ciResult.status === "success" || ciResult.status === "timeout"
    ? "completed"
    : "failed";
  await runner.completeStep(doneStep.id, { ciStatus: ciResult.status });
  await runner.updateRunStatus(runId, finalStatus);

  return { runId, status: finalStatus, sha };
}

async function pollCIStep(
  runner: BlueprintRunner,
  runId: string,
  ciManager: CIManager,
  repo: string,
  sha: string,
) {
  const ciStep = await runner.createStep(runId, "ci_poll", "deterministic");
  const ciResult = await ciManager.pollCI(repo, sha, CI_POLL_TIMEOUT_MS);
  await runner.completeStep(ciStep.id, ciResult);
  return ciResult;
}
