import Docker from "dockerode";
import type { DevboxCreateOptions, DevboxInfo, ExecResult } from "./types.js";

const PATCHWORK_LABEL = "patchwork.devbox";

export class DevboxManager {
  private docker: Docker;

  constructor(socketPath?: string) {
    this.docker = new Docker({
      socketPath: socketPath || "/var/run/docker.sock",
    });
  }

  async create(options: DevboxCreateOptions): Promise<DevboxInfo> {
    const container = await this.docker.createContainer({
      Image: options.image,
      name: options.name,
      Cmd: ["sleep", "infinity"],
      Env: options.env
        ? Object.entries(options.env).map(([k, v]) => `${k}=${v}`)
        : undefined,
      Labels: { [PATCHWORK_LABEL]: "true" },
      HostConfig: {
        Memory: options.memoryMB
          ? options.memoryMB * 1024 * 1024
          : undefined,
        NanoCpus: options.cpus ? options.cpus * 1e9 : undefined,
        NetworkMode: options.networkMode || "bridge",
        Binds: options.binds,
      },
    });

    await container.start();

    const info = await container.inspect();
    return {
      containerId: info.Id,
      status: "running",
      host: info.NetworkSettings?.IPAddress || "",
    };
  }

  async destroy(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    try {
      await container.stop({ t: 1 });
    } catch {
      // container may already be stopped
    }
    await container.remove({ force: true });
  }

  /**
   * Run a command inside a container using Docker's container execution API.
   * Note: This uses dockerode's container.exec() — the Docker engine API for
   * executing processes inside containers. This is NOT child_process.exec().
   */
  async runInContainer(
    containerId: string,
    cmd: string[]
  ): Promise<ExecResult> {
    const container = this.docker.getContainer(containerId);

    // Docker container exec API (not child_process — no shell injection risk)
    const execInst = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await execInst.start({});

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    // Use dockerode's built-in demuxer to split stdout/stderr
    const { PassThrough } = await import("node:stream");
    const stdoutPass = new PassThrough();
    const stderrPass = new PassThrough();

    stdoutPass.on("data", (chunk: Buffer) => stdout.push(chunk));
    stderrPass.on("data", (chunk: Buffer) => stderr.push(chunk));

    await new Promise<void>((resolve, reject) => {
      this.docker.modem.demuxStream(stream, stdoutPass, stderrPass);
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    const inspection = await execInst.inspect();

    return {
      exitCode: inspection.ExitCode ?? 0,
      stdout: Buffer.concat(stdout).toString("utf-8"),
      stderr: Buffer.concat(stderr).toString("utf-8"),
    };
  }

  async list(): Promise<DevboxInfo[]> {
    const containers = await this.docker.listContainers({
      all: false,
      filters: { label: [PATCHWORK_LABEL] },
    });

    return containers.map((c) => ({
      containerId: c.Id,
      status: c.State === "running" ? "running" : c.State,
      host: c.NetworkSettings?.Networks
        ? Object.values(c.NetworkSettings.Networks)[0]?.IPAddress || ""
        : "",
    }));
  }
}
