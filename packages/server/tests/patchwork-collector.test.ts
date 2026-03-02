import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SidecarClient } from "../src/agents/backend.js";
import { collectPatches } from "../src/patchwork/collector.js";
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
    readFile: vi.fn().mockRejectedValue(new Error("File not found")),
    writeFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("collectPatches", () => {
  let sidecar: SidecarClient;

  beforeEach(() => {
    sidecar = createMockSidecar();
  });

  it("checks for explicit patch files at /workspace/patches/ first", async () => {
    const patchContent = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1 +1 @@
-old
+new
`;
    // exec call order: 1) git rev-parse HEAD, 2) ls /workspace/patches/
    (sidecar.exec as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "abc123",
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "patch-001.patch\n",
        stderr: "",
      });
    (sidecar.readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(patchContent);

    const patches = await collectPatches(sidecar, "run-1", "step-1", "implementer");

    expect(patches).toHaveLength(1);
    expect(patches[0].patchContent).toBe(patchContent);
    expect(patches[0].runId).toBe("run-1");
    expect(patches[0].stepId).toBe("step-1");
    expect(patches[0].agentRole).toBe("implementer");
    expect(patches[0].files).toEqual(["foo.ts"]);
  });

  it("falls back to git diff when no explicit patches exist", async () => {
    const diffOutput = `diff --git a/bar.ts b/bar.ts
--- a/bar.ts
+++ b/bar.ts
@@ -1 +1 @@
-hello
+world
`;
    // exec call order: 1) git rev-parse HEAD, 2) ls /workspace/patches/ (fails)
    (sidecar.exec as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ exitCode: 0, stdout: "def456", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "No such file" });
    (sidecar.gitDiff as ReturnType<typeof vi.fn>).mockResolvedValue(diffOutput);

    const patches = await collectPatches(sidecar, "run-1", "step-1", "implementer");

    expect(patches).toHaveLength(1);
    expect(patches[0].patchContent).toBe(diffOutput);
    expect(patches[0].files).toEqual(["bar.ts"]);
    expect(sidecar.gitDiff).toHaveBeenCalled();
  });

  it("returns empty array when no changes exist", async () => {
    // exec call order: 1) git rev-parse HEAD, 2) ls /workspace/patches/ (fails)
    (sidecar.exec as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ exitCode: 0, stdout: "abc123", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "No such file" });
    (sidecar.gitDiff as ReturnType<typeof vi.fn>).mockResolvedValue("");

    const patches = await collectPatches(sidecar, "run-1", "step-1", "implementer");

    expect(patches).toHaveLength(0);
  });

  it("normalizes patch content with trailing newline", async () => {
    const diffWithoutNewline = "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b";
    // exec call order: 1) git rev-parse HEAD, 2) ls /workspace/patches/ (fails)
    (sidecar.exec as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ exitCode: 0, stdout: "abc123", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "No such file" });
    (sidecar.gitDiff as ReturnType<typeof vi.fn>).mockResolvedValue(diffWithoutNewline);

    const patches = await collectPatches(sidecar, "run-1", "step-1", "implementer");

    expect(patches).toHaveLength(1);
    expect(patches[0].patchContent.endsWith("\n")).toBe(true);
  });
});

describe("PatchStore", () => {
  let store: PatchStore;
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join("/tmp", `patchwork-test-${crypto.randomUUID()}`);
    await fs.mkdir(testDir, { recursive: true });
    store = new PatchStore(testDir);
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("stores a patch file to disk", async () => {
    const patch = {
      id: "patch-1",
      runId: "run-1",
      stepId: "step-1",
      agentRole: "implementer",
      baseSha: "abc123",
      repo: "test/repo",
      files: ["foo.ts"],
      patchContent: "diff --git a/foo.ts b/foo.ts\n",
      metadata: {
        intentSummary: "test change",
        confidence: "high" as const,
        risks: [],
        followups: [],
      },
      createdAt: new Date(),
    };

    await store.storePatch(patch);

    const filePath = path.join(testDir, "patches", "run-1", "patch-1.patch");
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe("diff --git a/foo.ts b/foo.ts\n");
  });

  it("loads all patches for a run from disk", async () => {
    const patch1 = {
      id: "patch-1",
      runId: "run-1",
      stepId: "step-1",
      agentRole: "implementer",
      baseSha: "abc123",
      repo: "test/repo",
      files: ["foo.ts"],
      patchContent: "diff a\n",
      metadata: {
        intentSummary: "change 1",
        confidence: "high" as const,
        risks: [],
        followups: [],
      },
      createdAt: new Date(),
    };

    const patch2 = {
      id: "patch-2",
      runId: "run-1",
      stepId: "step-2",
      agentRole: "reviewer",
      baseSha: "abc123",
      repo: "test/repo",
      files: ["bar.ts"],
      patchContent: "diff b\n",
      metadata: {
        intentSummary: "change 2",
        confidence: "medium" as const,
        risks: [],
        followups: [],
      },
      createdAt: new Date(),
    };

    await store.storePatch(patch1);
    await store.storePatch(patch2);

    const loaded = await store.loadPatches("run-1");
    expect(loaded).toHaveLength(2);
    expect(loaded.map((p) => p.id).sort()).toEqual(["patch-1", "patch-2"]);
  });

  it("loads a single patch by id", async () => {
    const patch = {
      id: "patch-1",
      runId: "run-1",
      stepId: "step-1",
      agentRole: "implementer",
      baseSha: "abc123",
      repo: "test/repo",
      files: ["foo.ts"],
      patchContent: "diff single\n",
      metadata: {
        intentSummary: "single change",
        confidence: "high" as const,
        risks: [],
        followups: [],
      },
      createdAt: new Date(),
    };

    await store.storePatch(patch);
    const loaded = await store.loadPatch("patch-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.patchContent).toBe("diff single\n");
  });

  it("returns null for non-existent patch", async () => {
    const loaded = await store.loadPatch("nonexistent");
    expect(loaded).toBeNull();
  });

  it("returns empty array for run with no patches", async () => {
    const loaded = await store.loadPatches("no-such-run");
    expect(loaded).toHaveLength(0);
  });
});
