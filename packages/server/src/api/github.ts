import { Router, type Router as RouterType } from "express";
import prisma from "../db/prisma.js";
import { insertIssue } from "../db/queries.js";
import { listUserRepos, listRepoIssues, listRepoBranches, getAuthenticatedUser } from "../github/client.js";

export const githubRouter: RouterType = Router();

async function getAccessToken(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: { userId, providerId: "github" },
  });
  return account?.accessToken ?? null;
}

// GET /api/github/user — get authenticated GitHub user profile
githubRouter.get("/user", async (req, res) => {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const token = await getAccessToken(user.id);
  if (!token) {
    res.status(400).json({ error: "No GitHub account linked" });
    return;
  }

  const ghUser = await getAuthenticatedUser(token);
  res.json(ghUser);
});

// GET /api/github/repos — list user's repos
githubRouter.get("/repos", async (req, res) => {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const token = await getAccessToken(user.id);
  if (!token) {
    res.status(400).json({ error: "No GitHub account linked" });
    return;
  }

  const repos = await listUserRepos(token);
  res.json(repos);
});

// GET /api/github/repos/:owner/:repo/branches — list branches for a repo
githubRouter.get("/repos/:owner/:repo/branches", async (req, res) => {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const token = await getAccessToken(user.id);
  if (!token) {
    res.status(400).json({ error: "No GitHub account linked" });
    return;
  }

  const { owner, repo } = req.params;
  try {
    const branches = await listRepoBranches(token, owner, repo);
    res.json(branches);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to fetch branches" });
  }
});

// GET /api/github/repos/:owner/:repo/issues — list issues for a repo
githubRouter.get("/repos/:owner/:repo/issues", async (req, res) => {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const token = await getAccessToken(user.id);
  if (!token) {
    res.status(400).json({ error: "No GitHub account linked" });
    return;
  }

  const { owner, repo } = req.params;
  const labels = req.query.labels as string | undefined;
  const issues = await listRepoIssues(token, owner, repo, labels);
  res.json(issues);
});

// POST /api/github/import — import GitHub issues to the board
githubRouter.post("/import", async (req, res) => {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const { owner, repo, issueNumbers } = req.body as {
    owner: string;
    repo: string;
    issueNumbers: number[];
  };

  if (!owner || !repo || !Array.isArray(issueNumbers) || issueNumbers.length === 0) {
    res.status(400).json({ error: "owner, repo, and issueNumbers[] are required" });
    return;
  }

  const token = await getAccessToken(user.id);
  if (!token) {
    res.status(400).json({ error: "No GitHub account linked" });
    return;
  }

  const fullRepo = `${owner}/${repo}`;
  const imported: string[] = [];
  const skipped: number[] = [];

  for (const num of issueNumbers) {
    // Check if already imported
    const existing = await prisma.issue.findFirst({
      where: { githubIssueId: num, repo: fullRepo },
    });
    if (existing) {
      skipped.push(num);
      continue;
    }

    // Fetch issue details from GitHub
    const { getIssue } = await import("../github/client.js");
    const ghIssue = await getIssue(token, owner, repo, num);

    const issue = await insertIssue({
      title: ghIssue.title,
      body: ghIssue.body || "",
      repo: fullRepo,
      branch: "main",
      githubIssueId: ghIssue.number,
      githubIssueUrl: ghIssue.html_url,
      createdByUserId: user.id,
    });

    imported.push(issue.identifier);
  }

  res.json({ imported, skipped });
});

// POST /api/github/sync — trigger manual sync for user's selected repos
githubRouter.post("/sync", async (req, res) => {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const settings = await prisma.userSettings.findUnique({
    where: { userId: user.id },
  });

  if (!settings) {
    res.status(400).json({ error: "No settings found. Complete onboarding first." });
    return;
  }

  const token = await getAccessToken(user.id);
  if (!token) {
    res.status(400).json({ error: "No GitHub account linked" });
    return;
  }

  const selectedRepos = (settings.selectedRepos as string[]) || [];
  let synced = 0;

  for (const repoFullName of selectedRepos) {
    const [owner, repo] = repoFullName.split("/");
    if (!owner || !repo) continue;

    const issues = await listRepoIssues(token, owner, repo, "patchwork");

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
        createdByUserId: user.id,
      });
      synced++;
    }
  }

  res.json({ synced });
});
