import type { SidecarClient } from "../agents/backend.js";
import type { PatchStore } from "./store.js";

export interface MergeResult {
  success: boolean;
  sha?: string;
  conflicts?: string[];
}

/**
 * PatchMerger applies collected patches to the working tree and commits.
 *
 * Strategy:
 * 1. Apply each patch sequentially via sidecar.gitApply()
 * 2. If sequential apply fails, try with --3way flag via sidecar HTTP API
 * 3. If all patches applied, commit via sidecar HTTP API
 *
 * Note: All sidecar calls are remote HTTP requests to the sidecar service
 * running inside the devbox container — not local process execution.
 */
export class PatchMerger {
  async mergeAndCommit(
    sidecar: SidecarClient,
    runId: string,
    patchStore: PatchStore
  ): Promise<MergeResult> {
    const patches = await patchStore.loadPatches(runId);

    if (patches.length === 0) {
      return { success: true };
    }

    const conflicts: string[] = [];

    for (const patch of patches) {
      // Try sequential apply first via sidecar HTTP endpoint
      const result = await sidecar.gitApply(patch.patchContent);
      if (result.success) {
        continue;
      }

      // Fall back to three-way merge via sidecar HTTP endpoint
      const threeWayResult = await sidecar.exec("git", [
        "apply",
        "--3way",
        "-",
      ]);

      if (threeWayResult.exitCode !== 0) {
        conflicts.push(
          `Patch ${patch.id}: ${threeWayResult.stderr || "merge conflict"}`
        );
      }
    }

    if (conflicts.length > 0) {
      return { success: false, conflicts };
    }

    // Stage all changes and commit via sidecar HTTP endpoints
    await sidecar.exec("git", ["add", "-A"]);

    const commitResult = await sidecar.exec("git", [
      "commit",
      "-m",
      `patchwork: apply ${patches.length} patch(es) for run ${runId}`,
    ]);

    if (commitResult.exitCode !== 0) {
      return {
        success: false,
        conflicts: [commitResult.stderr || "commit failed"],
      };
    }

    const sha = commitResult.stdout.trim();
    return { success: true, sha };
  }
}
