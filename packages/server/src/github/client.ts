import { Octokit } from "@octokit/rest";
import { cacheGet, cacheSet } from "../cache/redis.js";

export interface GitHubRepo {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  private: boolean;
  description: string | null;
  html_url: string;
  default_branch: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  labels: Array<{ name: string }>;
  created_at: string;
  updated_at: string;
}

function octokit(accessToken: string): Octokit {
  return new Octokit({ auth: accessToken });
}

export async function listUserRepos(accessToken: string): Promise<GitHubRepo[]> {
  const cacheKey = `gh:repos:${accessToken.slice(-8)}`;
  const cached = await cacheGet<GitHubRepo[]>(cacheKey);
  if (cached) return cached;

  const kit = octokit(accessToken);
  const repos: GitHubRepo[] = [];
  let page = 1;

  while (true) {
    const { data } = await kit.repos.listForAuthenticatedUser({
      per_page: 100,
      page,
      sort: "updated",
    });
    repos.push(...(data as unknown as GitHubRepo[]));
    if (data.length < 100) break;
    page++;
  }

  await cacheSet(cacheKey, repos, "medium");
  return repos;
}

export async function listRepoIssues(
  accessToken: string,
  owner: string,
  repo: string,
  labels?: string
): Promise<GitHubIssue[]> {
  const cacheKey = `gh:issues:${owner}/${repo}:${labels || "all"}`;
  const cached = await cacheGet<GitHubIssue[]>(cacheKey);
  if (cached) return cached;

  const kit = octokit(accessToken);
  const { data } = await kit.issues.listForRepo({
    owner,
    repo,
    state: "open",
    labels,
    per_page: 100,
  });

  const issues = data
    .filter((i) => !i.pull_request) // Exclude PRs
    .map((i) => ({
      number: i.number,
      title: i.title,
      body: i.body ?? null,
      state: i.state,
      html_url: i.html_url,
      labels: (i.labels || [])
        .filter((l): l is { name: string } => typeof l === "object" && l !== null && "name" in l)
        .map((l) => ({ name: l.name })),
      created_at: i.created_at,
      updated_at: i.updated_at,
    }));

  await cacheSet(cacheKey, issues, "fast");
  return issues;
}

export async function getIssue(
  accessToken: string,
  owner: string,
  repo: string,
  number: number
): Promise<GitHubIssue> {
  const cacheKey = `gh:issue:${owner}/${repo}/${number}`;
  const cached = await cacheGet<GitHubIssue>(cacheKey);
  if (cached) return cached;

  const kit = octokit(accessToken);
  const { data } = await kit.issues.get({ owner, repo, issue_number: number });

  const issue: GitHubIssue = {
    number: data.number,
    title: data.title,
    body: data.body ?? null,
    state: data.state,
    html_url: data.html_url,
    labels: (data.labels || [])
      .filter((l): l is { name: string } => typeof l === "object" && l !== null && "name" in l)
      .map((l) => ({ name: l.name })),
    created_at: data.created_at,
    updated_at: data.updated_at,
  };

  await cacheSet(cacheKey, issue, "fast");
  return issue;
}
