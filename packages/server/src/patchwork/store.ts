import type { PatchArtifact } from "@patchwork/shared";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * PatchStore handles persisting patches to the filesystem.
 * Each patch is stored at: {storePath}/patches/{runId}/{patchId}.patch
 * Metadata is stored alongside as {patchId}.json
 */
export class PatchStore {
  private storePath: string;

  constructor(storePath?: string) {
    this.storePath = storePath || process.env.FILE_STORE_PATH || "/data/patchwork";
  }

  private patchDir(runId: string): string {
    return path.join(this.storePath, "patches", runId);
  }

  private patchFilePath(runId: string, patchId: string): string {
    return path.join(this.patchDir(runId), `${patchId}.patch`);
  }

  private metaFilePath(runId: string, patchId: string): string {
    return path.join(this.patchDir(runId), `${patchId}.json`);
  }

  async storePatch(patch: PatchArtifact): Promise<void> {
    const dir = this.patchDir(patch.runId);
    await fs.mkdir(dir, { recursive: true });

    // Write patch content
    await fs.writeFile(this.patchFilePath(patch.runId, patch.id), patch.patchContent, "utf-8");

    // Write metadata (everything except patchContent)
    const meta = {
      id: patch.id,
      runId: patch.runId,
      stepId: patch.stepId,
      agentRole: patch.agentRole,
      baseSha: patch.baseSha,
      repo: patch.repo,
      files: patch.files,
      metadata: patch.metadata,
      createdAt: patch.createdAt.toISOString(),
    };
    await fs.writeFile(this.metaFilePath(patch.runId, patch.id), JSON.stringify(meta), "utf-8");
  }

  async loadPatches(runId: string): Promise<PatchArtifact[]> {
    const dir = this.patchDir(runId);
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return [];
    }

    const patchFiles = entries.filter((f) => f.endsWith(".patch"));
    const patches: PatchArtifact[] = [];

    for (const file of patchFiles) {
      const patchId = file.replace(".patch", "");
      const patch = await this.loadPatchFromDisk(runId, patchId);
      if (patch) patches.push(patch);
    }

    return patches;
  }

  async loadPatch(patchId: string): Promise<PatchArtifact | null> {
    // We need to search for the patch across run directories
    let runDirs: string[];
    try {
      runDirs = await fs.readdir(path.join(this.storePath, "patches"));
    } catch {
      return null;
    }

    for (const runId of runDirs) {
      const patch = await this.loadPatchFromDisk(runId, patchId);
      if (patch) return patch;
    }

    return null;
  }

  private async loadPatchFromDisk(runId: string, patchId: string): Promise<PatchArtifact | null> {
    try {
      const [patchContent, metaJson] = await Promise.all([
        fs.readFile(this.patchFilePath(runId, patchId), "utf-8"),
        fs.readFile(this.metaFilePath(runId, patchId), "utf-8"),
      ]);
      const meta = JSON.parse(metaJson);
      return {
        ...meta,
        patchContent,
        createdAt: new Date(meta.createdAt),
      };
    } catch {
      return null;
    }
  }
}
