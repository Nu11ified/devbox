import * as pty from "node-pty";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface AuthContainerConfig {
  timeoutMs: number;
}

interface ActiveSession {
  ptyProcess: pty.IPty;
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

  async spawnAuthContainer(
    userId: string,
    provider: string,
  ): Promise<{
    ptyProcess: pty.IPty;
    cleanup: () => Promise<void>;
  }> {
    if (this.activeSessions.has(userId)) {
      console.log(`[auth-pty] Destroying stale session for user ${userId}`);
      await this.destroyContainer(userId);
    }

    const cliDef = CLI_COMMANDS[provider];
    if (!cliDef) throw new Error(`Unknown provider: ${provider}`);

    const ptyProcess = pty.spawn(cliDef.cmd, cliDef.args, {
      name: "xterm-256color",
      cols: 120,
      rows: 30,
      env: process.env as Record<string, string>,
    });

    const cleanup = async () => {
      const entry = this.activeSessions.get(userId);
      if (entry?.timer) clearTimeout(entry.timer);
      this.activeSessions.delete(userId);
      try {
        ptyProcess.kill();
      } catch {}
    };

    const timer = setTimeout(async () => {
      await cleanup();
    }, this.config.timeoutMs);

    this.activeSessions.set(userId, { ptyProcess, timer });

    return { ptyProcess, cleanup };
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
        console.error(`[auth-pty] Error checking ${credDir}:`, err.message);
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

  async destroyContainer(userId: string): Promise<void> {
    const entry = this.activeSessions.get(userId);
    if (!entry) return;

    if (entry.timer) clearTimeout(entry.timer);
    this.activeSessions.delete(userId);

    try {
      entry.ptyProcess.kill();
    } catch {}
  }
}
