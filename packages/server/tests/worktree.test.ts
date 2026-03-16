import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createWorktree, removeWorktree, listWorktrees } from "../src/git/worktree.js";

// ── Tests ────────────────────────────────────────────────────────────────

describe("Git Worktree Utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── createWorktree ────────────────────────────────────────────────

  describe("createWorktree", () => {
    it("calls git worktree add with correct arguments", () => {
      createWorktree({
        repoDir: "/projects/p1/repo",
        worktreeDir: "/projects/p1/worktrees/abc123",
        branch: "feature-branch",
      });

      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        ["worktree", "add", "/projects/p1/worktrees/abc123", "-b", "feature-branch"],
        expect.objectContaining({
          cwd: "/projects/p1/repo",
          stdio: "pipe",
          timeout: 30000,
        })
      );
    });

    it("includes baseBranch when provided", () => {
      createWorktree({
        repoDir: "/projects/p1/repo",
        worktreeDir: "/projects/p1/worktrees/abc123",
        branch: "feature-branch",
        baseBranch: "develop",
      });

      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        ["worktree", "add", "/projects/p1/worktrees/abc123", "-b", "feature-branch", "develop"],
        expect.any(Object)
      );
    });

    it("creates parent directory if it does not exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);

      createWorktree({
        repoDir: "/projects/p1/repo",
        worktreeDir: "/projects/p1/worktrees/abc123",
        branch: "feature-branch",
      });

      expect(mkdirSync).toHaveBeenCalledWith(
        "/projects/p1/worktrees",
        { recursive: true }
      );
    });

    it("does not create parent directory if it already exists", () => {
      vi.mocked(existsSync).mockReturnValue(true);

      createWorktree({
        repoDir: "/projects/p1/repo",
        worktreeDir: "/projects/p1/worktrees/abc123",
        branch: "feature-branch",
      });

      expect(mkdirSync).not.toHaveBeenCalled();
    });
  });

  // ── removeWorktree ────────────────────────────────────────────────

  describe("removeWorktree", () => {
    it("calls git worktree remove with --force flag", () => {
      removeWorktree("/projects/p1/repo", "/projects/p1/worktrees/abc123");

      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        ["worktree", "remove", "/projects/p1/worktrees/abc123", "--force"],
        expect.objectContaining({
          cwd: "/projects/p1/repo",
          stdio: "pipe",
          timeout: 15000,
        })
      );
    });

    it("does not throw when worktree is already gone", () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error("fatal: '/path/to/worktree' is not a working tree");
      });

      // Should not throw
      expect(() => removeWorktree("/repo", "/worktree")).not.toThrow();
    });
  });

  // ── listWorktrees ─────────────────────────────────────────────────

  describe("listWorktrees", () => {
    it("parses porcelain output into worktree paths", () => {
      vi.mocked(execFileSync).mockReturnValue(
        "worktree /projects/p1/repo\nHEAD abc123\nbranch refs/heads/main\n\nworktree /projects/p1/worktrees/feat1\nHEAD def456\nbranch refs/heads/feat1\n\n" as any
      );

      const result = listWorktrees("/projects/p1/repo");

      expect(result).toEqual([
        "/projects/p1/repo",
        "/projects/p1/worktrees/feat1",
      ]);
    });

    it("returns empty array when git command fails", () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error("not a git repository");
      });

      const result = listWorktrees("/not-a-repo");

      expect(result).toEqual([]);
    });

    it("returns empty array when no worktrees exist", () => {
      vi.mocked(execFileSync).mockReturnValue("" as any);

      const result = listWorktrees("/projects/p1/repo");

      expect(result).toEqual([]);
    });
  });
});
