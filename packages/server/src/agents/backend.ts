// Re-export shared types for convenience
export type {
  AgentBackend,
  AgentConfig,
  AgentEvent,
  AgentSession,
} from "@patchwork/shared";

/**
 * SidecarClient is the interface agent backends use to communicate with
 * the sidecar running inside devbox containers.
 */
export interface SidecarClient {
  exec(
    cmd: string,
    args: string[],
    cwd?: string
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  gitDiff(cwd?: string): Promise<string>;
  gitApply(patch: string, cwd?: string): Promise<{ success: boolean }>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}
