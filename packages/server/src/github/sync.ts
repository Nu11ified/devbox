import prisma from "../db/prisma.js";
import { insertIssue } from "../db/queries.js";
import { listRepoIssues } from "./client.js";

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class GitHubSyncJob {
  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    console.log("GitHub sync job started (interval: 5m)");
    this.timer = setInterval(() => this.tick(), SYNC_INTERVAL_MS);
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
      const issues = await listRepoIssues(accessToken, owner, repo, "patchwork");

      for (const ghIssue of issues) {
        const existing = await prisma.issue.findFirst({
          where: { githubIssueId: ghIssue.number, repo: repoFullName },
        });
        if (existing) continue;

        await insertIssue({
          title: ghIssue.title,
          body: ghIssue.body || "",
          repo: repoFullName,
          branch: "main",
          githubIssueId: ghIssue.number,
          githubIssueUrl: ghIssue.html_url,
          createdByUserId: userId,
        });

        console.log(
          `Synced GitHub issue #${ghIssue.number} from ${repoFullName}`
        );
      }
    } catch (err) {
      console.error(`Failed to sync ${repoFullName}:`, err);
    }
  }
}
