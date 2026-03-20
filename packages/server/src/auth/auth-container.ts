import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface AuthContainerConfig {
  timeoutMs: number;
}

interface ActiveSession {
  process: ChildProcess;
  timer: ReturnType<typeof setTimeout> | null;
}

const POLL_INTERVAL_MS = 2000;

const CREDENTIAL_DIRS: Record<string, string> = {
  claude: join(homedir(), ".claude"),
  codex: join(homedir(), ".codex"),
};

const CREDENTIAL_SENTINELS: Record<string, string> = {
  claude: "credentials.json",
  codex: "auth.json",
};

const CLI_COMMANDS: Record<string, { cmd: string; args: string[] }> = {
  claude: { cmd: "claude", args: ["auth", "login"] },
  codex: { cmd: "codex", args: ["auth", "login"] },
};

export class AuthContainerService {
  private config: AuthContainerConfig;
  private activeSessions = new Map<string, ActiveSession>();

  constructor(config: AuthContainerConfig) {
    this.config = config;
  }

  hasActiveContainer(userId: string): boolean {
    return this.activeSessions.has(userId);
  }

  spawnAuthProcess(
    userId: string,
    provider: string,
  ): {
    process: ChildProcess;
    cleanup: () => Promise<void>;
  } {
    if (this.activeSessions.has(userId)) {
      console.log(`[auth] Destroying stale session for user ${userId}`);
      this.destroySession(userId);
    }

    const cliDef = CLI_COMMANDS[provider];
    if (!cliDef) throw new Error(`Unknown provider: ${provider}`);

    // Use `script` to wrap the command with a real PTY so interactive
    // CLIs (claude auth login) produce output and accept input properly.
    const fullCmd = [cliDef.cmd, ...cliDef.args].join(" ");
    const child = spawn("script", ["-qfc", fullCmd, "/dev/null"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, TERM: "xterm-256color" },
    });

    const cleanup = async () => {
      const entry = this.activeSessions.get(userId);
      if (entry?.timer) clearTimeout(entry.timer);
      this.activeSessions.delete(userId);
      try {
        child.kill();
      } catch {}
    };

    const timer = setTimeout(async () => {
      await cleanup();
    }, this.config.timeoutMs);

    this.activeSessions.set(userId, { process: child, timer });

    return { process: child, cleanup };
  }

  async pollForCredentials(
    provider: string,
    signal: AbortSignal,
  ): Promise<Record<string, Buffer> | null> {
    const credDir = CREDENTIAL_DIRS[provider];
    const sentinel = CREDENTIAL_SENTINELS[provider];
    if (!credDir || !sentinel) return null;

    while (!signal.aborted) {
      try {
        const sentinelPath = join(credDir, sentinel);
        if (existsSync(sentinelPath)) {
          const files: Record<string, Buffer> = {};
          this.readDirRecursive(credDir, credDir, files);
          if (files[sentinel]) {
            return files;
          }
        }
      } catch (err: any) {
        console.error(`[auth] Error checking ${credDir}:`, err.message);
      }

      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, POLL_INTERVAL_MS);
        signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
      });
    }

    return null;
  }

  private readDirRecursive(baseDir: string, dir: string, files: Record<string, Buffer>): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        this.readDirRecursive(baseDir, fullPath, files);
      } else if (entry.isFile()) {
        const relativePath = fullPath.slice(baseDir.length + 1);
        files[relativePath] = readFileSync(fullPath);
      }
    }
  }

  destroySession(userId: string): void {
    const entry = this.activeSessions.get(userId);
    if (!entry) return;

    if (entry.timer) clearTimeout(entry.timer);
    this.activeSessions.delete(userId);

    try {
      entry.process.kill();
    } catch {}
  }

  async destroyContainer(userId: string): Promise<void> {
    this.destroySession(userId);
  }
}
