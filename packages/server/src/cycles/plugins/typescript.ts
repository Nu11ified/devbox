// packages/server/src/cycles/plugins/typescript.ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { LanguageGatePlugin, GateCheckResult } from "./types.js";

function countTsErrors(stderr: string): number {
  const matches = stderr.match(/error TS\d+/g);
  return matches ? matches.length : 0;
}

function parseEslintProblems(stdout: string): { errors: number; warnings: number } {
  const match = stdout.match(/(\d+) problems? \((\d+) errors?, (\d+) warnings?\)/);
  if (match) return { errors: parseInt(match[2]), warnings: parseInt(match[3]) };
  return { errors: 0, warnings: 0 };
}

function parseVitestResults(stdout: string): { passed: number; failed: number } {
  const failMatch = stdout.match(/(\d+) failed/);
  const passMatch = stdout.match(/(\d+) passed/);
  return {
    failed: failMatch ? parseInt(failMatch[1]) : 0,
    passed: passMatch ? parseInt(passMatch[1]) : 0,
  };
}

export const typescriptPlugin: LanguageGatePlugin = {
  language: "typescript",

  detect: async (workspacePath: string): Promise<boolean> => {
    return existsSync(join(workspacePath, "tsconfig.json"));
  },

  checks: {
    typecheck: {
      command: "npx tsc --noEmit",
      parseOutput(stdout: string, stderr: string, exitCode: number): GateCheckResult {
        if (exitCode === 0) {
          return { passed: true, summary: "No type errors", errorCount: 0 };
        }
        const errorCount = countTsErrors(stderr);
        return {
          passed: false,
          summary: `${errorCount} type error${errorCount !== 1 ? "s" : ""}`,
          details: stderr,
          errorCount,
        };
      },
    },

    lint: {
      command: "npx eslint . --max-warnings=0",
      parseOutput(stdout: string, stderr: string, exitCode: number): GateCheckResult {
        if (exitCode === 0) {
          return { passed: true, summary: "No lint issues", errorCount: 0, warningCount: 0 };
        }
        const { errors, warnings } = parseEslintProblems(stdout);
        return {
          passed: false,
          summary: `${errors} error${errors !== 1 ? "s" : ""}, ${warnings} warning${warnings !== 1 ? "s" : ""}`,
          details: stdout || stderr,
          errorCount: errors,
          warningCount: warnings,
        };
      },
    },

    test: {
      command: "npx vitest run",
      parseOutput(stdout: string, stderr: string, exitCode: number): GateCheckResult {
        const { passed, failed } = parseVitestResults(stdout);
        if (exitCode === 0) {
          return { passed: true, summary: `${passed} passed`, errorCount: 0 };
        }
        return {
          passed: false,
          summary: `${failed} failed, ${passed} passed`,
          details: stdout || stderr,
          errorCount: failed,
        };
      },
    },

    build: {
      command: "npx tsc",
      parseOutput(stdout: string, stderr: string, exitCode: number): GateCheckResult {
        if (exitCode === 0) {
          return { passed: true, summary: "Build succeeded", errorCount: 0 };
        }
        const errorCount = countTsErrors(stderr);
        return {
          passed: false,
          summary: `Build failed with ${errorCount} error${errorCount !== 1 ? "s" : ""}`,
          details: stderr,
          errorCount,
        };
      },
    },
  },
};
