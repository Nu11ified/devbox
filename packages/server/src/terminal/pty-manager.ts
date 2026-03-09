import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";

export interface PtySession {
  id: string;
  proc: ChildProcess;
  threadId: string;
  emitter: EventEmitter;
}

/**
 * Manages PTY sessions using `script -qc` to allocate real pseudo-terminals.
 * Uses Node.js child_process.spawn for compatibility with both Bun and Node.js.
 */
export class PtyManager {
  private sessions = new Map<string, PtySession>();

  start(opts: {
    sessionId: string;
    threadId: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    shell?: string;
  }): PtySession {
    const existing = this.sessions.get(opts.sessionId);
    if (existing) return existing;

    const shell = opts.shell || process.env.SHELL || "/bin/bash";
    const cols = opts.cols ?? 120;
    const rows = opts.rows ?? 30;

    // Use `script -qc` to allocate a real PTY that supports tmux, colors, etc.
    const proc = spawn("script", ["-qc", `${shell} --login`, "/dev/null"], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: opts.cwd ?? process.env.HOME ?? "/",
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        COLUMNS: String(cols),
        LINES: String(rows),
      },
    });

    const emitter = new EventEmitter();

    // Stream stdout to emitter
    proc.stdout?.on("data", (chunk: Buffer) => {
      emitter.emit("data", chunk.toString());
    });

    // Also capture stderr (some shells send prompt there)
    proc.stderr?.on("data", (chunk: Buffer) => {
      emitter.emit("data", chunk.toString());
    });

    proc.on("exit", (code, signal) => {
      emitter.emit("exit", { exitCode: code ?? 0, signal: signal ?? 0 });
      this.sessions.delete(opts.sessionId);
    });

    proc.on("error", (err) => {
      console.error(`[pty-manager] Process error for ${opts.sessionId}:`, err.message);
      emitter.emit("exit", { exitCode: 1, signal: 0 });
      this.sessions.delete(opts.sessionId);
    });

    const session: PtySession = {
      id: opts.sessionId,
      proc,
      threadId: opts.threadId,
      emitter,
    };
    this.sessions.set(opts.sessionId, session);
    return session;
  }

  write(sessionId: string, data: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    try {
      session.proc.stdin?.write(data);
      return true;
    } catch {
      return false;
    }
  }

  resize(_sessionId: string, _cols: number, _rows: number): boolean {
    // Note: `script -qc` allocates a PTY but doesn't expose a way to
    // send SIGWINCH externally. The terminal size is set via COLUMNS/LINES
    // env vars at start time. For full resize support, use the sidecar's
    // node-pty when connected to a devbox container.
    return true;
  }

  kill(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    try {
      session.proc.kill();
    } catch {
      // Already dead
    }
    this.sessions.delete(sessionId);
    return true;
  }

  getForThread(threadId: string): PtySession | undefined {
    for (const session of this.sessions.values()) {
      if (session.threadId === threadId) return session;
    }
    return undefined;
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  killAll(): void {
    for (const session of this.sessions.values()) {
      try {
        session.proc.kill();
      } catch {
        // Already dead
      }
    }
    this.sessions.clear();
  }
}

export const ptyManager = new PtyManager();
