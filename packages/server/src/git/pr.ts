import { execFileSync } from "node:child_process";

export interface CommitPushPROptions {
  cwd: string;
  branch: string;
  baseBranch: string;
  title: string;
  body: string;
  authorName: string;
  authorEmail: string;
  githubToken: string;
  repo: string; // "owner/repo"
}

export function commitAllChanges(opts: {
  cwd: string;
  message: string;
  authorName: string;
  authorEmail: string;
}): boolean {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: opts.authorName,
    GIT_AUTHOR_EMAIL: opts.authorEmail,
    GIT_COMMITTER_NAME: opts.authorName,
    GIT_COMMITTER_EMAIL: opts.authorEmail,
  };

  // Stage all changes
  execFileSync("git", ["add", "-A"], { cwd: opts.cwd, stdio: "pipe", env });

  // Check if there are changes to commit
  try {
    execFileSync("git", ["diff", "--cached", "--quiet"], { cwd: opts.cwd, stdio: "pipe" });
    return false; // No changes
  } catch {
    // Has changes — commit
    execFileSync("git", ["commit", "-m", opts.message], { cwd: opts.cwd, stdio: "pipe", env });
    return true;
  }
}

export function pushBranch(opts: {
  cwd: string;
  branch: string;
  githubToken?: string;
  repo?: string;
}): void {
  // If we have a token, set it for push auth
  if (opts.githubToken && opts.repo) {
    const remoteUrl = `https://x-access-token:${opts.githubToken}@github.com/${opts.repo}.git`;
    execFileSync("git", ["remote", "set-url", "origin", remoteUrl], { cwd: opts.cwd, stdio: "pipe" });
  }
  execFileSync("git", ["push", "-u", "origin", opts.branch], { cwd: opts.cwd, stdio: "pipe", timeout: 60000 });
}
