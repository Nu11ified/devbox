import type { PatchArtifact, PatchMetadata } from "@patchwork/shared";
import type { SidecarClient } from "../agents/backend.js";
import { randomUUID } from "node:crypto";

const PATCHES_DIR = "/workspace/patches";

/**
 * Extract affected file paths from a unified diff string.
 */
function extractFiles(diff: string): string[] {
  const files: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      files.push(line.slice(6));
    }
  }
  return files;
}

/**
 * Ensure patch content ends with a newline and strip empty hunks.
 */
function normalizePatch(content: string): string {
  // Strip empty hunks (hunks with no actual changes)
  let normalized = content.replace(
    /^@@[^@]*@@\n(?=@@|\Z)/gm,
    ""
  );
  // Ensure trailing newline
  if (normalized.length > 0 && !normalized.endsWith("\n")) {
    normalized += "\n";
  }
  return normalized;
}

/**
 * Collect patches from a devbox after an agent step completes.
 *
 * Note: All sidecar.exec() calls are HTTP requests to the sidecar service
 * running inside the devbox container — not local shell execution.
 *
 * Strategy:
 * 1. Check for explicit patch files at /workspace/patches/
 * 2. Fall back to sidecar.gitDiff() to generate a diff
 * 3. Normalize and return PatchArtifact[]
 */
export async function collectPatches(
  sidecar: SidecarClient,
  runId: string,
  stepId: string,
  agentRole: string
): Promise<PatchArtifact[]> {
  const patches: PatchArtifact[] = [];

  // Get the current HEAD sha for baseSha
  const shaResult = await sidecar.exec("git", ["rev-parse", "HEAD"]);
  const baseSha = shaResult.stdout.trim();

  // 1. Check for explicit patch files
  const explicitPatches = await tryReadExplicitPatches(sidecar, runId, stepId, agentRole, baseSha);
  if (explicitPatches.length > 0) {
    return explicitPatches;
  }

  // 2. Fall back to git diff
  const diff = await sidecar.gitDiff();
  if (!diff || diff.trim().length === 0) {
    return [];
  }

  const normalized = normalizePatch(diff);
  const files = extractFiles(normalized);

  patches.push({
    id: randomUUID(),
    runId,
    stepId,
    agentRole,
    baseSha,
    repo: "",
    files,
    patchContent: normalized,
    metadata: {
      intentSummary: "",
      confidence: "medium",
      risks: [],
      followups: [],
    },
    createdAt: new Date(),
  });

  return patches;
}

async function tryReadExplicitPatches(
  sidecar: SidecarClient,
  runId: string,
  stepId: string,
  agentRole: string,
  baseSha: string
): Promise<PatchArtifact[]> {
  // List files in the patches directory via sidecar HTTP endpoint
  const lsResult = await sidecar.exec("ls", [PATCHES_DIR]);
  if (lsResult.exitCode !== 0 || !lsResult.stdout.trim()) {
    return [];
  }

  const filenames = lsResult.stdout.trim().split("\n").filter(Boolean);
  const patches: PatchArtifact[] = [];

  for (const filename of filenames) {
    const content = await sidecar.readFile(`${PATCHES_DIR}/${filename}`);
    const normalized = normalizePatch(content);
    if (normalized.trim().length === 0) continue;

    const files = extractFiles(normalized);
    patches.push({
      id: randomUUID(),
      runId,
      stepId,
      agentRole,
      baseSha,
      repo: "",
      files,
      patchContent: normalized,
      metadata: {
        intentSummary: "",
        confidence: "medium",
        risks: [],
        followups: [],
      },
      createdAt: new Date(),
    });
  }

  return patches;
}
