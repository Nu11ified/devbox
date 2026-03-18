// packages/server/src/cycles/plugins/types.ts

export interface GateCheckResult {
  passed: boolean;
  summary: string;
  details?: string;
  errorCount?: number;
  warningCount?: number;
}

export interface GateCommand {
  /** Shell command to run (e.g. "npx tsc --noEmit") */
  command: string;
  /** Additional args appended to command */
  args?: string[];
  /** Parse raw output into structured result */
  parseOutput(stdout: string, stderr: string, exitCode: number): GateCheckResult;
}

export interface LanguageGatePlugin {
  /** Language identifier (e.g. "typescript", "go", "rust") */
  language: string;
  /** Auto-detect whether this plugin applies to a workspace */
  detect(workspacePath: string): Promise<boolean>;
  /** Available gate checks — not all languages support all check types */
  checks: {
    typecheck?: GateCommand;
    lint?: GateCommand;
    test?: GateCommand;
    build?: GateCommand;
  };
}

export type GateCheckType = "typecheck" | "lint" | "test" | "build" | "custom";
