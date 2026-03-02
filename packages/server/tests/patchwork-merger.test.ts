import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SidecarClient } from "../src/agents/backend.js";
import type { PatchArtifact } from "@patchwork/shared";
import { PatchMerger } from "../src/patchwork/merger.js";
import { PatchStore } from "../src/patchwork/store.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";

// --- Mock helpers ---

function createMockSidecar(overrides: Partial<SidecarClient> = {}): SidecarClient {
  return {
    exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
    gitDiff: vi.fn().mockResolvedValue(""),
    gitApply: vi.fn().mockResolvedValue({ success: true }),
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makePatch(id: string, content: string): PatchArtifact {
  return {
    id,
    runId: "run-1",
    stepId: "step-1",
    agentRole: "implementer",
    baseSha: "abc123",
    repo: "test/repo",
    files: ["file.ts"],
    patchContent: content,
    metadata: {
      intentSummary: "test",
      confidence: "high",
      risks: [],
      followups: [],
    },
    createdAt: new Date(),
  };
}

describe("PatchMerger", () => {
  let sidecar: SidecarClient;
  let store: PatchStore;
  let merger: PatchMerger;
  let testDir: string;

  beforeEach(async () => {
    sidecar = createMockSidecar();
    testDir = path.join("/tmp", `patchwork-merger-test-${crypto.randomUUID()}`);
    await fs.mkdir(testDir, { recursive: true });
    store = new PatchStore(testDir);
    merger = new PatchMerger();
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("applies patches sequentially and commits", async () => {
    const patch1 = makePatch("p1", "diff for file1\n");
    const patch2 = makePatch("p2", "diff for file2\n");
    await store.storePatch(patch1);
    await store.storePatch(patch2);

    // gitApply succeeds for both
    (sidecar.gitApply as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
    // git commit returns a SHA
    (sidecar.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
      exitCode: 0,
      stdout: "abc123def",
      stderr: "",
    });

    const result = await merger.mergeAndCommit(sidecar, "run-1", store);

    expect(result.success).toBe(true);
    expect(result.sha).toBe("abc123def");
    expect(sidecar.gitApply).toHaveBeenCalledTimes(2);
  });

  it("falls back to three-way merge on sequential failure", async () => {
    const patch1 = makePatch("p1", "diff conflict\n");
    await store.storePatch(patch1);

    // First gitApply fails, then three-way exec succeeds
    (sidecar.gitApply as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: false });
    // Three-way apply via exec
    (sidecar.exec as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" }) // git apply --3way
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" }) // git add -A
      .mockResolvedValueOnce({ exitCode: 0, stdout: "sha456", stderr: "" }); // git commit

    const result = await merger.mergeAndCommit(sidecar, "run-1", store);

    expect(result.success).toBe(true);
    expect(result.sha).toBe("sha456");
  });

  it("reports conflicts when both strategies fail", async () => {
    const patch1 = makePatch("p1", "diff irreconcilable\n");
    await store.storePatch(patch1);

    // Both strategies fail
    (sidecar.gitApply as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false });
    (sidecar.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "CONFLICT: merge conflict in file.ts",
    });

    const result = await merger.mergeAndCommit(sidecar, "run-1", store);

    expect(result.success).toBe(false);
    expect(result.conflicts).toBeDefined();
    expect(result.conflicts!.length).toBeGreaterThan(0);
  });

  it("returns success with no patches", async () => {
    const result = await merger.mergeAndCommit(sidecar, "run-1", store);

    expect(result.success).toBe(true);
    expect(sidecar.gitApply).not.toHaveBeenCalled();
  });

  it("commits with a descriptive message", async () => {
    const patch1 = makePatch("p1", "diff\n");
    await store.storePatch(patch1);

    (sidecar.gitApply as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });
    (sidecar.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
      exitCode: 0,
      stdout: "commitsha",
      stderr: "",
    });

    await merger.mergeAndCommit(sidecar, "run-1", store);

    // Verify git commit was called with a message
    const commitCalls = (sidecar.exec as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => call[0] === "git" && (call[1] as string[])[0] === "commit"
    );
    expect(commitCalls.length).toBe(1);
    expect(commitCalls[0][1]).toContain("-m");
  });
});
