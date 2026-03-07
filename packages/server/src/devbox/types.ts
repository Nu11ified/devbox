export interface DevboxCreateOptions {
  image: string;
  name?: string;
  env?: Record<string, string>;
  cpus?: number;
  memoryMB?: number;
  networkMode?: string;
  binds?: string[];
}

export interface DevboxInfo {
  containerId: string;
  status: string;
  host: string;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
