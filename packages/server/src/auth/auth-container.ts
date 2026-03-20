import Docker from "dockerode";
import tar from "tar-stream";

export interface AuthContainerConfig {
  image: string;
  timeoutMs: number;
}

interface ActiveContainer {
  containerId: string;
  timer: ReturnType<typeof setTimeout> | null;
}

const POLL_INTERVAL_MS = 2000;

// Poll directories (not individual files) to capture all credential files
const CREDENTIAL_PATHS: Record<string, string[]> = {
  claude: ["/home/user/.claude/"],
  codex: ["/home/user/.codex/"],
};

// Sentinel files that confirm auth completed
const CREDENTIAL_SENTINELS: Record<string, string> = {
  claude: "credentials.json",
  codex: "auth.json",
};

const CLI_COMMANDS: Record<string, string[]> = {
  claude: ["claude", "login"],
  codex: ["codex", "login"],
};

export class AuthContainerService {
  private docker: Docker;
  private config: AuthContainerConfig;
  private activeContainers = new Map<string, ActiveContainer>();

  constructor(config: AuthContainerConfig, docker?: Docker) {
    this.config = config;
    this.docker = docker ?? new Docker({ socketPath: "/var/run/docker.sock" });
  }

  hasActiveContainer(userId: string): boolean {
    return this.activeContainers.has(userId);
  }

  /** Test helper — set active container entry. */
  _setActiveContainer(userId: string, entry: ActiveContainer): void {
    this.activeContainers.set(userId, entry);
  }

  async spawnAuthContainer(
    userId: string,
    provider: string,
  ): Promise<{
    containerId: string;
    cleanup: () => Promise<void>;
  }> {
    if (this.activeContainers.has(userId)) {
      throw new Error("Auth container already active for this user");
    }

    const cliCmd = CLI_COMMANDS[provider];
    if (!cliCmd) throw new Error(`Unknown provider: ${provider}`);

    const container = await this.docker.createContainer({
      Image: this.config.image,
      Cmd: cliCmd,
      Tty: true,
      OpenStdin: true,
      HostConfig: {
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges:true"],
        PidsLimit: 64,
        Tmpfs: { "/home/user": "rw,noexec,nosuid,size=64m" },
      },
    });

    const containerId = container.id;

    const cleanup = async () => {
      const entry = this.activeContainers.get(userId);
      if (entry?.timer) clearTimeout(entry.timer);
      this.activeContainers.delete(userId);
      try {
        await container.stop({ t: 2 });
      } catch {}
      try {
        await container.remove({ force: true });
      } catch {}
    };

    const timer = setTimeout(async () => {
      await cleanup();
    }, this.config.timeoutMs);

    this.activeContainers.set(userId, { containerId, timer });
    await container.start();

    return { containerId, cleanup };
  }

  async pollForCredentials(
    containerId: string,
    provider: string,
    signal: AbortSignal,
  ): Promise<Record<string, Buffer> | null> {
    const paths = CREDENTIAL_PATHS[provider];
    if (!paths) return null;

    const container = this.docker.getContainer(containerId);
    const sentinel = CREDENTIAL_SENTINELS[provider];

    while (!signal.aborted) {
      for (const dirPath of paths) {
        try {
          const archiveStream = await container.getArchive({ path: dirPath });
          const files = await this.extractTarStream(archiveStream);
          if (sentinel && files[sentinel]) {
            return files;
          }
        } catch (err: any) {
          if (err.statusCode !== 404) {
            console.error(`[auth-container] Error checking ${dirPath}:`, err.message);
          }
        }
      }

      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, POLL_INTERVAL_MS);
        signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
      });
    }

    return null;
  }

  private async extractTarStream(stream: NodeJS.ReadableStream): Promise<Record<string, Buffer>> {
    return new Promise((resolve, reject) => {
      const extract = tar.extract();
      const files: Record<string, Buffer> = {};

      extract.on("entry", (header, entryStream, next) => {
        const chunks: Buffer[] = [];
        entryStream.on("data", (chunk: Buffer) => chunks.push(chunk));
        entryStream.on("end", () => {
          if (header.type === "file") {
            const parts = header.name.split("/");
            const relativePath = parts.length > 1 ? parts.slice(1).join("/") : header.name;
            if (relativePath) files[relativePath] = Buffer.concat(chunks);
          }
          next();
        });
        entryStream.resume();
      });

      extract.on("finish", () => resolve(files));
      extract.on("error", reject);

      (stream as any).pipe(extract);
    });
  }

  async destroyContainer(userId: string): Promise<void> {
    const entry = this.activeContainers.get(userId);
    if (!entry) return;

    if (entry.timer) clearTimeout(entry.timer);
    this.activeContainers.delete(userId);

    try {
      const container = this.docker.getContainer(entry.containerId);
      await container.stop({ t: 2 });
      await container.remove({ force: true });
    } catch {}
  }
}
