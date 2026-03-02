import * as pty from "node-pty";

type DataCallback = (data: string) => void;
type ExitCallback = (exitCode: number) => void;

export class PtySession {
  readonly id: string;
  private process: pty.IPty;
  private dataCallbacks: DataCallback[] = [];
  private exitCallbacks: ExitCallback[] = [];
  private _exitCode: number | null = null;
  private exitPromise: Promise<number>;

  constructor(id: string, cmd: string, args: string[], cwd?: string, cols = 80, rows = 24) {
    this.id = id;
    this.process = pty.spawn(cmd, args, {
      name: "xterm-256color",
      cols,
      rows,
      cwd: cwd || process.cwd(),
      env: process.env as Record<string, string>,
    });

    this.process.onData((data) => {
      for (const cb of this.dataCallbacks) cb(data);
    });

    this.exitPromise = new Promise<number>((resolve) => {
      this.process.onExit(({ exitCode }) => {
        this._exitCode = exitCode;
        for (const cb of this.exitCallbacks) cb(exitCode);
        resolve(exitCode);
      });
    });
  }

  get exitCode(): number | null {
    return this._exitCode;
  }

  onData(callback: DataCallback): void {
    this.dataCallbacks.push(callback);
  }

  onExit(callback: ExitCallback): void {
    if (this._exitCode !== null) {
      callback(this._exitCode);
      return;
    }
    this.exitCallbacks.push(callback);
  }

  write(data: string): void {
    this.process.write(data);
  }

  resize(cols: number, rows: number): void {
    this.process.resize(cols, rows);
  }

  kill(): void {
    this.process.kill();
  }

  waitForExit(): Promise<number> {
    return this.exitPromise;
  }
}

export class PtyManager {
  private sessions = new Map<string, PtySession>();

  start(
    id: string,
    cmd: string,
    args: string[] = [],
    cwd?: string,
    cols?: number,
    rows?: number
  ): PtySession {
    if (this.sessions.has(id)) {
      throw new Error(`Session ${id} already exists`);
    }
    const session = new PtySession(id, cmd, args, cwd, cols, rows);
    this.sessions.set(id, session);

    // Auto-cleanup on exit
    session.onExit(() => {
      this.sessions.delete(id);
    });

    return session;
  }

  get(id: string): PtySession | undefined {
    return this.sessions.get(id);
  }

  destroy(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) return false;
    session.kill();
    this.sessions.delete(id);
    return true;
  }

  destroyAll(): void {
    for (const [id] of this.sessions) {
      this.destroy(id);
    }
  }
}
