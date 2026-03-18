import { Effect } from "effect";
import prisma from "../db/prisma.js";
import { updateIssue } from "../db/queries.js";
import { createWorktree } from "../git/worktree.js";
import { commitAllChanges, pushBranch } from "../git/pr.js";
import type { ProviderService } from "../providers/service.js";
import { ThreadId } from "../providers/types.js";
import { findRelevantContext } from "./context-search.js";
import { getAllBlueprints, getBlueprint } from "../cycles/blueprints.js";

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
 * Build the autonomous prompt that tells Claude to implement the issue.
 * Behavioral rules (no questions, commit often, etc.) live in the system prompt
 * via the `append` field on the claude_code preset — this prompt is purely the task.
 */
function buildAutonomousPrompt(issue: {
  identifier: string;
  title: string;
  body: string;
  repo: string;
  branch: string;
}): string {
  return `## Issue: ${issue.identifier} — ${issue.title}

${issue.body}

---

**Repository:** ${issue.repo} (branch: \`${issue.branch}\`)

Implement this issue. Start by reading the relevant code to understand the codebase, then make the changes described above. Commit your work when complete.
`;
}

/** Map issue labels to blueprint IDs */
const LABEL_TO_BLUEPRINT: Record<string, string> = {
  bug: "debug",
  fix: "debug",
  feature: "feature-dev",
  enhancement: "feature-dev",
  review: "code-review",
  "code-review": "code-review",
  deploy: "production-check",
  release: "production-check",
};

/**
 * Detect which blueprint cycle to use based on issue labels and content.
 * Returns a blueprintId or undefined if no match.
 */
function detectCycleFromIssue(issue: {
  blueprintId?: string;
  labels?: string[];
  title: string;
  body: string;
}): string | undefined {
  // Explicit blueprintId takes priority
  if (issue.blueprintId && getBlueprint(issue.blueprintId)) {
    return issue.blueprintId;
  }

  // Check labels
  const labels = Array.isArray(issue.labels) ? issue.labels : [];
  for (const label of labels) {
    const normalizedLabel = String(label).toLowerCase();
    if (LABEL_TO_BLUEPRINT[normalizedLabel]) {
      return LABEL_TO_BLUEPRINT[normalizedLabel];
    }
  }

  // Fall back to keyword matching on title + body
  const text = `${issue.title} ${issue.body}`.toLowerCase();
  for (const bp of getAllBlueprints()) {
    for (const keyword of bp.trigger.keywords) {
      if (text.includes(keyword.toLowerCase())) {
        return bp.id;
      }
    }
  }

  return undefined;
}

/**
 * Retrieve issue labels from the database.
 */
async function getIssueLabels(issueId: string): Promise<string[]> {
  try {
    const issue = await prisma.issue.findUnique({
      where: { id: issueId },
      select: { labels: true },
    });
    if (!issue?.labels) return [];
    return Array.isArray(issue.labels) ? issue.labels.map(String) : [];
  } catch {
    return [];
  }
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
  let baseBranch = issue.branch; // fallback to issue's branch

  if (projectId) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (project?.workspacePath) {
      workspacePath = project.workspacePath;
      baseBranch = project.branch; // prefer project's branch over issue's

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

  // Detect cycle from issue labels/keywords
  const detectedBlueprintId = detectCycleFromIssue({
    blueprintId: issue.blueprintId,
    labels: await getIssueLabels(issue.id),
    title: issue.title,
    body: issue.body,
  });

  if (detectedBlueprintId) {
    console.log(`[dispatcher] detected cycle "${detectedBlueprintId}" for ${issue.identifier}`);
  }

  // Build autonomous prompt with past context injection
  let prompt = buildAutonomousPrompt(issue);

  // If a cycle was detected, instruct the agent to start it
  if (detectedBlueprintId) {
    prompt += `\n\n**Development Cycle:** This issue matches the "${detectedBlueprintId}" cycle. Start by running \`cycle_start\` with blueprintId "${detectedBlueprintId}" to activate structured quality gates.\n`;
  }

  const pastContext = await findRelevantContext(issue.title, issue.body, issue.projectId);
  if (pastContext) {
    prompt += "\n\n" + pastContext;
  }
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
          base: baseBranch,
          title: `${issue.identifier}: ${issue.title}`,
          body: `Automated implementation for issue ${issue.identifier}.\n\n${issue.body}\n\n---\n_Created by Patchwork_`,
          githubToken,
          issueIdentifier: issue.identifier,
        });

        console.log(`[dispatcher] PR created for ${issue.identifier}: ${prUrl}`);
        await updateIssue(issue.id, { status: "review", lastError: null, prUrl });
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
