import type { SidecarClient } from "./backend.js";

/**
 * HTTP client for communicating with the sidecar running inside devbox containers.
 * Uses the built-in Node.js fetch API (Node 18+).
 *
 * Note: The method names like "exec" refer to HTTP endpoints on the sidecar service,
 * NOT local process execution. All calls are remote HTTP requests.
 */
export class SidecarHttpClient implements SidecarClient {
  readonly url: string;

  constructor(baseUrl: string) {
    this.url = baseUrl;
  }

  /** POST /exec — runs a command inside the devbox container via sidecar HTTP API */
  async exec(
    cmd: string,
    args: string[],
    cwd?: string
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const res = await fetch(`${this.url}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd, args, cwd }),
    });
    return await res.json() as { exitCode: number; stdout: string; stderr: string };
  }

  /** GET /git/diff — retrieves unified diff from the devbox via sidecar */
  async gitDiff(cwd?: string): Promise<string> {
    const params = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
    const res = await fetch(`${this.url}/git/diff${params}`);
    const data = await res.json() as { diff: string };
    return data.diff;
  }

  /** POST /git/apply — applies a patch inside the devbox via sidecar */
  async gitApply(patch: string, cwd?: string): Promise<{ success: boolean }> {
    const res = await fetch(`${this.url}/git/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patch, cwd }),
    });
    return await res.json() as { success: boolean };
  }

  /** GET /fs/read — reads a file from the devbox filesystem via sidecar */
  async readFile(path: string): Promise<string> {
    const res = await fetch(
      `${this.url}/fs/read?path=${encodeURIComponent(path)}`
    );
    const data = await res.json() as { content: string };
    return data.content;
  }

  /** POST /fs/write — writes a file to the devbox filesystem via sidecar */
  async writeFile(path: string, content: string): Promise<void> {
    await fetch(`${this.url}/fs/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    });
  }

  /** POST /pty/start — starts a PTY session inside the devbox via sidecar */
  async ptyStart(
    command: string,
    args?: string[]
  ): Promise<{ sessionId: string }> {
    const res = await fetch(`${this.url}/pty/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: command, args }),
    });
    return await res.json() as { sessionId: string };
  }

  /** POST /pty/write — sends data to a PTY session's stdin via sidecar */
  async ptyWrite(sessionId: string, data: string): Promise<void> {
    await fetch(`${this.url}/pty/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, data }),
    });
  }

  /** POST /pty/kill — terminates a PTY session inside the devbox via sidecar */
  async ptyKill(sessionId: string): Promise<void> {
    await fetch(`${this.url}/pty/kill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
  }
}
