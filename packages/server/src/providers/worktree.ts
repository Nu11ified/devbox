import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const execAsync = promisify(exec);

const WORKTREE_BASE = process.env.PATCHWORK_WORKTREE_DIR ?? "/tmp/patchwork/worktrees";

export interface WorktreeInfo {
  path: string;
  branch: string;
  threadId: string;
}

export class WorktreeManager {
  private repoPath: string;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
  }

  async create(threadId: string, branchName?: string): Promise<WorktreeInfo> {
    const safeBranch = branchName ?? `patchwork/${threadId.slice(0, 8)}`;
    const worktreePath = join(WORKTREE_BASE, threadId);

    if (!existsSync(WORKTREE_BASE)) {
      mkdirSync(WORKTREE_BASE, { recursive: true });
    }

    await execAsync(
      `git worktree add "${worktreePath}" -b "${safeBranch}"`,
      { cwd: this.repoPath }
    );

    return { path: worktreePath, branch: safeBranch, threadId };
  }

  async remove(threadId: string): Promise<void> {
    const worktreePath = join(WORKTREE_BASE, threadId);
    if (existsSync(worktreePath)) {
      await execAsync(
        `git worktree remove "${worktreePath}" --force`,
        { cwd: this.repoPath }
      );
    }
  }

  async getDiff(threadId: string): Promise<string> {
    const worktreePath = join(WORKTREE_BASE, threadId);
    const { stdout } = await execAsync("git diff HEAD", { cwd: worktreePath });
    return stdout;
  }

  async list(): Promise<WorktreeInfo[]> {
    const { stdout } = await execAsync("git worktree list --porcelain", {
      cwd: this.repoPath,
    });

    const entries: WorktreeInfo[] = [];
    let currentPath = "";
    let currentBranch = "";

    for (const line of stdout.split("\n")) {
      if (line.startsWith("worktree ")) {
        currentPath = line.slice(9);
      } else if (line.startsWith("branch ")) {
        currentBranch = line.slice(7).replace("refs/heads/", "");
      } else if (line === "") {
        if (currentPath.startsWith(WORKTREE_BASE)) {
          const threadId = currentPath.split("/").pop() ?? "";
          entries.push({ path: currentPath, branch: currentBranch, threadId });
        }
        currentPath = "";
        currentBranch = "";
      }
    }

    return entries;
  }
}
