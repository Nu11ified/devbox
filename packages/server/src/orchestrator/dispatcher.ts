import { Effect } from "effect";
import prisma from "../db/prisma.js";
import { updateIssue } from "../db/queries.js";
import { createWorktree } from "../git/worktree.js";
import { commitAllChanges, pushBranch } from "../git/pr.js";
import type { ProviderService } from "../providers/service.js";
import { ThreadId } from "../providers/types.js";

/**
 * Sanitize a string for use as a git branch name.
 */
function sanitizeBranchName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\-_/]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Build the autonomous prompt that tells Claude to implement the issue
 * without asking questions, just code.
 */
function buildAutonomousPrompt(issue: {
  identifier: string;
  title: string;
  body: string;
  repo: string;
  branch: string;
}): string {
  return `You are working autonomously on a GitHub issue. Do NOT ask questions — just implement the solution.

## Issue: ${issue.identifier} — ${issue.title}

${issue.body}

## Instructions

1. Read the codebase to understand the relevant code
2. Implement the fix or feature described in the issue
3. Make sure your changes are complete and working
4. Do NOT ask for clarification — make reasonable decisions and implement
5. If tests exist, run them to verify your changes
6. Keep changes focused on the issue — don't refactor unrelated code

Repository: ${issue.repo} (branch: ${issue.branch})
`;
}

/**
 * Dispatches a single issue: creates a worktree, thread, sends an autonomous
 * prompt, waits for completion, then auto-creates a PR.
 */
export async function dispatchIssue(
  issue: {
    id: string;
    identifier: string;
    blueprintId: string;
    templateId: string | null;
    repo: string;
    branch: string;
    title: string;
    body: string;
    createdByUserId?: string | null;
    projectId?: string | null;
  },
  providerService?: ProviderService
): Promise<void> {
  if (!providerService) {
    console.error(`[dispatcher] no providerService — cannot dispatch ${issue.identifier}`);
    await updateIssue(issue.id, {
      status: "open",
      lastError: "No provider service available",
    });
    return;
  }

  // Resolve user credentials
  const userSettings = issue.createdByUserId
    ? await prisma.userSettings.findUnique({
        where: { userId: issue.createdByUserId },
      })
    : null;

  let githubToken: string | undefined;
  if (issue.createdByUserId) {
    const account = await prisma.account.findFirst({
      where: { userId: issue.createdByUserId, providerId: "github" },
    });
    githubToken = account?.accessToken ?? undefined;
  }

  // Resolve user profile for git commit identity
  let authorName = "Patchwork";
  let authorEmail = "patchwork@localhost";
  if (issue.createdByUserId) {
    const user = await prisma.user.findUnique({
      where: { id: issue.createdByUserId },
    });
    if (user) {
      authorName = user.name ?? "Patchwork";
      authorEmail = user.email;
    }
  }

  const apiKey = userSettings?.anthropicApiKey ?? undefined;
  const useSubscription = userSettings?.claudeSubscription ?? false;

  // Look up the project for workspace path
  let workspacePath = "/workspace";
  let worktreePath: string | undefined;
  let worktreeBranch: string | undefined;
  let projectId = issue.projectId ?? undefined;

  if (projectId) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (project?.workspacePath) {
      workspacePath = project.workspacePath;

      // Create a git worktree for isolated work
      worktreeBranch = `thread/issue-${sanitizeBranchName(issue.identifier)}`;
      worktreePath = `${project.workspacePath}/../worktrees/${issue.id.slice(0, 8)}`;

      try {
        createWorktree({
          repoDir: project.workspacePath,
          worktreeDir: worktreePath,
          branch: worktreeBranch,
          baseBranch: project.branch,
        });
        workspacePath = worktreePath;
        console.log(`[dispatcher] created worktree at ${worktreePath} (branch: ${worktreeBranch})`);
      } catch (err) {
        console.error(`[dispatcher] worktree creation failed:`, err);
        // Fall back to project workspace
        worktreePath = undefined;
        worktreeBranch = undefined;
      }
    }
  }

  // Create thread via ProviderService
  let threadId: string;
  try {
    const { thread } = await Effect.runPromise(
      providerService.createThread({
        title: issue.title,
        provider: "claudeCode",
        runtimeMode: "full-access",
        workspacePath,
        useSubscription,
        apiKey,
        githubToken,
        userId: issue.createdByUserId ?? undefined,
        issueId: issue.id,
        repo: issue.repo,
        branch: issue.branch,
        projectId,
        worktreePath,
        worktreeBranch,
      })
    );
    threadId = thread.id;
    console.log(`[dispatcher] created thread ${threadId} for issue ${issue.identifier}`);
  } catch (err) {
    console.error(`[dispatcher] failed to create thread for ${issue.identifier}:`, err);
    await updateIssue(issue.id, {
      status: "open",
      lastError: `Thread creation failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  // Update issue status to in_progress
  await updateIssue(issue.id, { status: "in_progress" });

  // Send autonomous prompt
  const prompt = buildAutonomousPrompt(issue);
  try {
    await Effect.runPromise(
      providerService.sendTurn({
        threadId: ThreadId(threadId),
        text: prompt,
      })
    );
    console.log(`[dispatcher] sent autonomous prompt for ${issue.identifier}`);
  } catch (err) {
    console.error(`[dispatcher] failed to send turn for ${issue.identifier}:`, err);
    await updateIssue(issue.id, {
      lastError: `Failed to send prompt: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  // Wait for turn completion by listening to the event stream
  try {
    await waitForTurnCompletion(providerService, threadId, issue.id);
  } catch (err) {
    console.error(`[dispatcher] turn wait error for ${issue.identifier}:`, err);
    await updateIssue(issue.id, {
      lastError: `Turn failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  // Auto-create PR if there are changes
  if (worktreePath && worktreeBranch && githubToken) {
    try {
      const hasChanges = commitAllChanges({
        cwd: worktreePath,
        message: `${issue.identifier}: ${issue.title}\n\nAutonomous implementation by Patchwork.`,
        authorName,
        authorEmail,
      });

      if (hasChanges) {
        pushBranch({
          cwd: worktreePath,
          branch: worktreeBranch,
          githubToken,
          repo: issue.repo,
        });

        // Create PR via GitHub API
        const prUrl = await createGitHubPR({
          repo: issue.repo,
          head: worktreeBranch,
          base: issue.branch,
          title: `${issue.identifier}: ${issue.title}`,
          body: `Automated implementation for issue ${issue.identifier}.\n\n${issue.body}\n\n---\n_Created by Patchwork_`,
          githubToken,
          issueIdentifier: issue.identifier,
        });

        console.log(`[dispatcher] PR created for ${issue.identifier}: ${prUrl}`);
        await updateIssue(issue.id, { status: "review", lastError: null });

        // TODO: store PR URL on issue (needs schema field)
      } else {
        console.log(`[dispatcher] no changes to commit for ${issue.identifier}`);
        await updateIssue(issue.id, {
          status: "review",
          lastError: "Completed but no code changes were made",
        });
      }
    } catch (err) {
      console.error(`[dispatcher] PR creation failed for ${issue.identifier}:`, err);
      await updateIssue(issue.id, {
        status: "review",
        lastError: `PR creation failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  } else {
    // No worktree or no GitHub token — mark as review anyway
    await updateIssue(issue.id, { status: "review", lastError: null });
  }
}

/**
 * Wait for the turn to complete by subscribing to the provider event stream.
 * Resolves when turn.completed fires, rejects on runtime.error or timeout.
 */
function waitForTurnCompletion(
  providerService: ProviderService,
  threadId: string,
  issueId: string,
  timeoutMs = 600_000 // 10 minutes
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Turn timed out"));
    }, timeoutMs);

    // Poll the thread status every 5 seconds
    const poll = setInterval(async () => {
      try {
        const thread = await prisma.thread.findUnique({
          where: { id: threadId },
          select: { status: true },
        });

        // Check the latest assistant turn
        const lastTurn = await prisma.threadTurn.findFirst({
          where: { threadId, role: "assistant" },
          orderBy: { startedAt: "desc" },
          select: { status: true },
        });

        if (lastTurn?.status === "completed") {
          clearInterval(poll);
          clearTimeout(timeout);
          resolve();
        }

        // Check for error events
        const errorEvent = await prisma.threadEvent.findFirst({
          where: {
            threadId,
            type: "runtime.error",
          },
          orderBy: { createdAt: "desc" },
        });

        if (errorEvent && !lastTurn) {
          clearInterval(poll);
          clearTimeout(timeout);
          const payload = errorEvent.payload as any;
          reject(new Error(payload?.message ?? "Runtime error"));
        }
      } catch {
        // Continue polling
      }
    }, 5_000);
  });
}

/**
 * Create a GitHub PR using the REST API.
 */
async function createGitHubPR(opts: {
  repo: string;
  head: string;
  base: string;
  title: string;
  body: string;
  githubToken: string;
  issueIdentifier?: string;
}): Promise<string> {
  const response = await fetch(
    `https://api.github.com/repos/${opts.repo}/pulls`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.githubToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: opts.title,
        body: opts.body,
        head: opts.head,
        base: opts.base,
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return data.html_url;
}
