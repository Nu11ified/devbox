// packages/server/src/cycles/gates.ts
import { execFileSync } from "node:child_process";
import { getPlugin } from "./plugins/index.js";
import type { GateCheckResult, GateCheckType } from "./plugins/types.js";

export interface GateCheckInput {
  type: GateCheckType;
  language: string;
  command?: string; // for custom checks
}

/**
 * Run a single gate check. Executes the command from the language plugin,
 * captures output, and returns a parsed result.
 */
export async function runGateCheck(
  type: GateCheckType,
  language: string,
  workspacePath: string,
  customCommand?: string,
): Promise<GateCheckResult> {
  // Custom check — run raw command
  if (type === "custom" && customCommand) {
    return runCustomCheck(customCommand, workspacePath);
  }

  const plugin = getPlugin(language);
  if (!plugin) {
    throw new Error(`No gate plugin registered for language: ${language}`);
  }

  const gateCommand = plugin.checks[type as keyof typeof plugin.checks];
  if (!gateCommand) {
    throw new Error(`Language plugin '${language}' does not support check type: ${type}`);
  }

  // Parse the command string into executable + args
  const parts = gateCommand.command.split(/\s+/);
  const executable = parts[0];
  const args = [...parts.slice(1), ...(gateCommand.args ?? [])];

  try {
    const stdout = execFileSync(executable, args, {
      cwd: workspacePath,
      stdio: "pipe",
      encoding: "utf-8",
      timeout: 300000, // 5 minute timeout
    });
    return gateCommand.parseOutput(stdout, "", 0);
  } catch (err: any) {
    const stdout = err.stdout?.toString() ?? "";
    const stderr = err.stderr?.toString() ?? "";
    const exitCode = err.status ?? 1;
    return gateCommand.parseOutput(stdout, stderr, exitCode);
  }
}

/**
 * Run multiple gate checks sequentially, returning all results.
 * Does not short-circuit — all checks run even if earlier ones fail.
 */
export async function runGateChecks(
  checks: GateCheckInput[],
  workspacePath: string,
): Promise<GateCheckResult[]> {
  const results: GateCheckResult[] = [];
  for (const check of checks) {
    const result = await runGateCheck(check.type, check.language, workspacePath, check.command);
    results.push(result);
  }
  return results;
}

function runCustomCheck(command: string, workspacePath: string): GateCheckResult {
  const parts = command.split(/\s+/);
  try {
    const stdout = execFileSync(parts[0], parts.slice(1), {
      cwd: workspacePath,
      stdio: "pipe",
      encoding: "utf-8",
      timeout: 300000,
    });
    return { passed: true, summary: "Custom check passed", details: stdout };
  } catch (err: any) {
    return {
      passed: false,
      summary: "Custom check failed",
      details: err.stderr?.toString() ?? err.message,
      errorCount: 1,
    };
  }
}
