import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../src/db/prisma.js", () => ({
  default: {
    ankiCard: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────

import prisma from "../src/db/prisma.js";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { runAnkiStalenessCheck } from "../src/providers/claude-code/anki-staleness.js";

// ── Helpers ──────────────────────────────────────────────────────────────

const PROJECT_ID = "project-123";
const WORKSPACE = "/tmp/test-workspace";

function makeCard(
  overrides: Partial<{
    id: string;
    referencedFiles: string[];
    lastVerifiedAt: Date;
  }> = {}
) {
  return {
    id: overrides.id ?? "card-1",
    referencedFiles: overrides.referencedFiles ?? ["src/foo.ts"],
    lastVerifiedAt: overrides.lastVerifiedAt ?? new Date("2026-03-01T00:00:00Z"),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("runAnkiStalenessCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: workspace and .git both exist
    vi.mocked(existsSync).mockReturnValue(true);
    // Default: no cards with referenced files
    vi.mocked(prisma.ankiCard.findMany).mockResolvedValue([]);
    // Default: git returns empty output
    vi.mocked(execFileSync).mockReturnValue("" as any);
  });

  // ── Phase 1: Auto-cleanup ─────────────────────────────────────────

  describe("auto-cleanup", () => {
    it("deletes stale cards older than 7 days", async () => {
      const before = new Date();
      await runAnkiStalenessCheck(PROJECT_ID, WORKSPACE);
      const after = new Date();

      expect(prisma.ankiCard.deleteMany).toHaveBeenCalledOnce();
      const call = vi.mocked(prisma.ankiCard.deleteMany).mock.calls[0][0];
      expect(call).toMatchObject({
        where: {
          projectId: PROJECT_ID,
          stale: true,
          updatedAt: { lt: expect.any(Date) },
        },
      });

      // The cutoff date should be ~7 days before now
      const cutoff: Date = (call as any).where.updatedAt.lt;
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(before.getTime() - cutoff.getTime()).toBeCloseTo(sevenDaysMs, -3);
      expect(after.getTime() - cutoff.getTime()).toBeCloseTo(sevenDaysMs, -3);
    });
  });

  // ── Phase 2: Staleness detection ─────────────────────────────────

  describe("staleness detection", () => {
    it("marks a card stale when its referenced file appears in git log output", async () => {
      const card = makeCard({ referencedFiles: ["src/foo.ts"], id: "card-stale" });
      vi.mocked(prisma.ankiCard.findMany).mockResolvedValue([card] as any);
      vi.mocked(execFileSync).mockReturnValue(
        "\nsrc/foo.ts\nsrc/bar.ts\n" as any
      );

      await runAnkiStalenessCheck(PROJECT_ID, WORKSPACE);

      expect(prisma.ankiCard.update).toHaveBeenCalledWith({
        where: { id: "card-stale" },
        data: {
          stale: true,
          staleReason: "Referenced file src/foo.ts changed since last verified",
        },
      });
    });

    it("does NOT mark a card stale when none of its referenced files changed", async () => {
      const card = makeCard({ referencedFiles: ["src/untouched.ts"], id: "card-clean" });
      vi.mocked(prisma.ankiCard.findMany).mockResolvedValue([card] as any);
      vi.mocked(execFileSync).mockReturnValue(
        "\nsrc/other.ts\nsrc/another.ts\n" as any
      );

      await runAnkiStalenessCheck(PROJECT_ID, WORKSPACE);

      expect(prisma.ankiCard.update).not.toHaveBeenCalled();
    });

    it("passes --since with the oldest lastVerifiedAt to git log", async () => {
      const older = new Date("2026-02-01T00:00:00Z");
      const newer = new Date("2026-03-10T00:00:00Z");
      const cards = [
        makeCard({ id: "card-1", referencedFiles: ["a.ts"], lastVerifiedAt: newer }),
        makeCard({ id: "card-2", referencedFiles: ["b.ts"], lastVerifiedAt: older }),
      ];
      vi.mocked(prisma.ankiCard.findMany).mockResolvedValue(cards as any);
      vi.mocked(execFileSync).mockReturnValue("" as any);

      await runAnkiStalenessCheck(PROJECT_ID, WORKSPACE);

      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        ["log", `--since=${older.toISOString()}`, "--name-only", "--pretty=format:"],
        expect.objectContaining({ cwd: WORKSPACE, encoding: "utf-8" })
      );
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("skips git check when workspace path does not exist", async () => {
      vi.mocked(existsSync).mockImplementation((p) => {
        if (p === WORKSPACE) return false;
        return true;
      });

      await runAnkiStalenessCheck(PROJECT_ID, WORKSPACE);

      expect(execFileSync).not.toHaveBeenCalled();
      expect(prisma.ankiCard.findMany).not.toHaveBeenCalled();
    });

    it("skips git check when .git directory does not exist", async () => {
      vi.mocked(existsSync).mockImplementation((p) => {
        if (typeof p === "string" && p.endsWith("/.git")) return false;
        return true;
      });

      await runAnkiStalenessCheck(PROJECT_ID, WORKSPACE);

      expect(execFileSync).not.toHaveBeenCalled();
      expect(prisma.ankiCard.findMany).not.toHaveBeenCalled();
    });

    it("skips git command when no cards have referencedFiles", async () => {
      vi.mocked(prisma.ankiCard.findMany).mockResolvedValue([] as any);

      await runAnkiStalenessCheck(PROJECT_ID, WORKSPACE);

      expect(execFileSync).not.toHaveBeenCalled();
    });

    it("skips staleness update when execFileSync throws (not a git repo)", async () => {
      const card = makeCard({ referencedFiles: ["src/foo.ts"] });
      vi.mocked(prisma.ankiCard.findMany).mockResolvedValue([card] as any);
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error("not a git repository");
      });

      // Should not throw
      await expect(runAnkiStalenessCheck(PROJECT_ID, WORKSPACE)).resolves.toBeUndefined();
      expect(prisma.ankiCard.update).not.toHaveBeenCalled();
    });

    it("only marks affected cards stale; leaves unaffected cards alone", async () => {
      const cards = [
        makeCard({ id: "card-dirty", referencedFiles: ["src/changed.ts"] }),
        makeCard({ id: "card-clean", referencedFiles: ["src/unchanged.ts"] }),
      ];
      vi.mocked(prisma.ankiCard.findMany).mockResolvedValue(cards as any);
      vi.mocked(execFileSync).mockReturnValue(
        "\nsrc/changed.ts\n" as any
      );

      await runAnkiStalenessCheck(PROJECT_ID, WORKSPACE);

      expect(prisma.ankiCard.update).toHaveBeenCalledOnce();
      expect(prisma.ankiCard.update).toHaveBeenCalledWith({
        where: { id: "card-dirty" },
        data: expect.objectContaining({ stale: true }),
      });
    });
  });
});
