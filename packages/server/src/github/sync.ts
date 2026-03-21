import prisma from "../db/prisma.js";
import { insertIssue, updateIssue } from "../db/queries.js";
import { listRepoIssues } from "./client.js";
import { cacheInvalidate } from "../cache/redis.js";

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class GitHubSyncJob {
  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    console.log("GitHub sync job started (interval: 5m)");
    this.timer = setInterval(() => this.tick(), SYNC_INTERVAL_MS);
    // Delay the first sync to let container networking (DNS) stabilise
    setTimeout(() => this.tick(), 10_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log("GitHub sync job stopped");
  }

  private async tick(): Promise<void> {
    try {
      // Find all users who completed onboarding
      const allSettings = await prisma.userSettings.findMany({
        where: { onboardingCompleted: true },
        include: { user: { include: { accounts: true } } },
      });

      for (const settings of allSettings) {
        const ghAccount = settings.user.accounts.find(
          (a) => a.providerId === "github"
        );
        if (!ghAccount?.accessToken) continue;

        const selectedRepos = (settings.selectedRepos as string[]) || [];

        for (const repoFullName of selectedRepos) {
          await this.syncRepo(
            ghAccount.accessToken,
            repoFullName,
            settings.userId
          );
        }
      }
    } catch (err) {
      console.error("GitHub sync tick error:", err);
    }
  }

  private async syncRepo(
    accessToken: string,
    repoFullName: string,
    userId: string
  ): Promise<void> {
    const [owner, repo] = repoFullName.split("/");
    if (!owner || !repo) return;

    try {
      // Invalidate cached issues so we get fresh data every sync
      await cacheInvalidate(`gh:issues:${repoFullName}:*`);

      // Fetch all open issues (no label filter)
      const issues = await listRepoIssues(accessToken, owner, repo);

      for (const ghIssue of issues) {
        const existing = await prisma.issue.findFirst({
          where: { githubIssueId: ghIssue.number, repo: repoFullName },
        });
        if (existing) continue;

        const ghLabels = ghIssue.labels.map((l) => l.name);
        const hasAutoLabel = ghLabels.some(
          (name) => name.toLowerCase() === "auto"
        );

        // Find a project that matches this repo so auto issues can be dispatched
        const project = await prisma.project.findFirst({
          where: { repo: repoFullName, userId },
        });

        const issue = await insertIssue({
          title: ghIssue.title,
          body: ghIssue.body || "",
          repo: repoFullName,
          branch: project?.branch || "main",
          githubIssueId: ghIssue.number,
          githubIssueUrl: ghIssue.html_url,
          createdByUserId: userId,
          labels: ghLabels,
          projectId: project?.id,
        });

        // If the issue has the "auto" label and a matching project exists,
        // set it to "queued" so the orchestrator picks it up automatically
        if (hasAutoLabel && project) {
          await updateIssue(issue.id, { status: "queued" });
          console.log(
            `Synced & queued GitHub issue #${ghIssue.number} from ${repoFullName} (auto label)`
          );
        } else {
          console.log(
            `Synced GitHub issue #${ghIssue.number} from ${repoFullName}`
          );
        }
      }
    } catch (err) {
      console.error(`Failed to sync ${repoFullName}:`, err);
    }
  }
}
