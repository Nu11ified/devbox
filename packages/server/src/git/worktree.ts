import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";

export function createWorktree(opts: {
  repoDir: string;
  worktreeDir: string;
  branch: string;
  baseBranch?: string;
}): void {
  const { repoDir, worktreeDir, branch, baseBranch } = opts;
  const parentDir = worktreeDir.substring(0, worktreeDir.lastIndexOf("/"));
  if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });

  const args = ["worktree", "add", worktreeDir, "-b", branch];
  if (baseBranch) args.push(baseBranch);

  execFileSync("git", args, { cwd: repoDir, stdio: "pipe", timeout: 30000 });
}

export function removeWorktree(repoDir: string, worktreeDir: string): void {
  try {
    execFileSync("git", ["worktree", "remove", worktreeDir, "--force"], {
      cwd: repoDir,
      stdio: "pipe",
      timeout: 15000,
    });
  } catch {
    // Worktree may already be gone
  }
}

export function listWorktrees(repoDir: string): string[] {
  try {
    const out = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd: repoDir,
      encoding: "utf-8",
      timeout: 10000,
    });
    return out
      .split("\n")
      .filter((l) => l.startsWith("worktree "))
      .map((l) => l.replace("worktree ", ""));
  } catch {
    return [];
  }
}
