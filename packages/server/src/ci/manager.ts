import type { SidecarClient } from "../agents/backend.js";

export interface CIResult {
  status: "success" | "failure" | "timeout";
  logs?: string;
  url?: string;
}

export interface CIFailure {
  type: "test" | "build" | "lint";
  message: string;
  file?: string;
  line?: number;
}

const POLL_INTERVAL_MS = 5_000;

/**
 * CIManager handles pushing branches and polling CI status
 * via the sidecar's HTTP exec endpoint. All commands run inside
 * the devbox container — no local shell execution.
 */
export class CIManager {
  constructor(private sidecar: SidecarClient) {}

  async pushBranch(branch: string): Promise<{ success: boolean }> {
    const result = await this.sidecar.exec("git", ["push", "origin", branch]);
    return { success: result.exitCode === 0 };
  }

  async pollCI(repo: string, sha: string, timeoutMs: number): Promise<CIResult> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const listResult = await this.sidecar.exec("gh", [
        "run", "list",
        "--repo", repo,
        "--commit", sha,
        "--limit", "1",
        "--json", "databaseId,status,conclusion,url",
        "--jq", ".[] | [.databaseId, .status, .conclusion, .url] | @tsv",
      ]);

      if (listResult.exitCode === 0 && listResult.stdout.trim()) {
        const parts = listResult.stdout.trim().split("\t");
        const [runId, status, conclusion, url] = parts;

        if (status === "completed") {
          if (conclusion === "success") {
            return { status: "success", url };
          }

          // Fetch logs for failed run
          const logResult = await this.sidecar.exec("gh", [
            "run", "view", runId,
            "--repo", repo,
            "--log",
          ]);
          const logs = logResult.stdout || "";
          return { status: "failure", logs, url };
        }
      }

      // Wait before next poll, but don't exceed deadline
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await sleep(Math.min(POLL_INTERVAL_MS, remaining));
    }

    return { status: "timeout" };
  }

  parseFailures(logs: string): CIFailure[] {
    const failures: CIFailure[] = [];

    // Test failures: "FAIL src/utils.test.ts"
    for (const match of logs.matchAll(/^FAIL\s+(\S+)/gm)) {
      failures.push({
        type: "test",
        message: `Test suite failed: ${match[1]}`,
        file: match[1],
      });
    }

    // Build errors: "src/index.ts(10,5): error TS2322: ..."
    for (const match of logs.matchAll(/^(\S+?)\((\d+),\d+\):\s*error\s+(.+)$/gm)) {
      failures.push({
        type: "build",
        message: match[3],
        file: match[1],
        line: parseInt(match[2], 10),
      });
    }

    // Lint errors: "  3:10  error  'foo' is defined but never used"
    for (const match of logs.matchAll(/^\s+(\d+):\d+\s+error\s+(.+)$/gm)) {
      failures.push({
        type: "lint",
        message: match[2],
        line: parseInt(match[1], 10),
      });
    }

    return failures;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
