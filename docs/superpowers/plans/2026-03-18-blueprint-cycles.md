# Blueprint Development Cycles Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a blueprint engine that enforces structured development cycles with deterministic quality gates for AI coding agents.

**Architecture:** State machine engine walks blueprint nodes (agentic + deterministic). Language gate plugins run typecheck/lint/test checks. Cycle state persisted to Prisma. Events flow through existing WebSocket pipeline. Agent interacts via MCP tools.

**Tech Stack:** TypeScript, Vitest, Prisma, Express, Effect Queue, Claude Agent SDK MCP tools

**Spec:** `docs/superpowers/specs/2026-03-18-blueprint-cycles-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/server/src/cycles/plugins/types.ts` | `LanguageGatePlugin`, `GateCommand`, `GateCheckResult` interfaces |
| `packages/server/src/cycles/plugins/typescript.ts` | TypeScript gate plugin (tsc, eslint, vitest) |
| `packages/server/src/cycles/plugins/index.ts` | Plugin registry — register/lookup by language |
| `packages/server/src/cycles/gates.ts` | Gate runner — executes gate checks via plugins |
| `packages/server/src/cycles/types.ts` | `Blueprint`, `BlueprintNode`, `Gate`, `CycleRunState` types |
| `packages/server/src/cycles/blueprints.ts` | Four hardcoded cycle definitions |
| `packages/server/src/cycles/events.ts` | `CycleEvent` type + emitter helper |
| `packages/server/src/cycles/engine.ts` | Core state machine — node dispatch, fix loops, gate enforcement |
| `packages/server/src/cycles/loader.ts` | Custom cycle config loader from `.patchwork/cycles/` |
| `packages/server/src/api/cycles.ts` | REST endpoints for cycle status |
| `packages/server/tests/gate-plugins.test.ts` | Tests for gate plugin interface + TypeScript plugin |
| `packages/server/tests/gate-runner.test.ts` | Tests for gate runner |
| `packages/server/tests/cycle-engine.test.ts` | Tests for engine state machine |
| `packages/server/tests/cycle-blueprints.test.ts` | Tests for blueprint validation |
| `packages/server/tests/cycle-loader.test.ts` | Tests for custom cycle config loader |
| `packages/server/tests/cycle-api.test.ts` | Tests for REST endpoints |
| `packages/ui/src/components/thread/cycle-status-bar.tsx` | Cycle progress bar component |
| `packages/ui/src/components/thread/gate-result.tsx` | Expandable gate result card |
| `packages/ui/tests/cycle-status-bar.test.ts` | Tests for status bar |

### Modified Files

| File | Change |
|------|--------|
| `packages/server/prisma/schema.prisma` | Add `CycleRun`, `CycleNodeResult` models + Thread relation |
| `packages/server/src/providers/claude-code/custom-tools.ts` | Add `cycle_start`, `cycle_status`, `cycle_advance`, `cycle_skip` MCP tools |
| `packages/server/src/providers/claude-code/adapter.ts` | Inject cycle phase prompt, check active CycleRun |
| `packages/server/src/providers/claude-code/hooks.ts` | PreToolUse hook to block commit when gates haven't passed |
| `packages/server/src/providers/events.ts` | Extend event type union with cycle events |
| `packages/server/src/orchestrator/dispatcher.ts` | Detect cycle from issue labels, pass blueprintId |
| `packages/server/src/index.ts` | Mount cycles router |
| `packages/ui/src/components/thread/timeline.tsx` | Add `phase_transition`, `gate_result`, `cycle_summary` kinds |
| `packages/ui/src/app/projects/[projectId]/threads/[id]/page.tsx` | Mount CycleStatusBar |
| `packages/ui/src/lib/api.ts` | Add cycle status API methods |

---

## Sub-Project 1: Quality Gates Foundation

### Task 1: Gate Plugin Type Definitions

**Files:**
- Create: `packages/server/src/cycles/plugins/types.ts`

- [ ] **Step 1: Create the type definitions file**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/cycles/plugins/types.ts
git commit -m "feat: add language gate plugin type definitions"
```

---

### Task 2: TypeScript Gate Plugin

**Files:**
- Create: `packages/server/src/cycles/plugins/typescript.ts`
- Test: `packages/server/tests/gate-plugins.test.ts`

- [ ] **Step 1: Write failing tests for the TypeScript plugin**

```typescript
// packages/server/tests/gate-plugins.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

import { existsSync } from "node:fs";
import { typescriptPlugin } from "../src/cycles/plugins/typescript.js";

describe("TypeScript Gate Plugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("detect", () => {
    it("returns true when tsconfig.json exists", async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      const result = await typescriptPlugin.detect("/workspace");
      expect(result).toBe(true);
      expect(existsSync).toHaveBeenCalledWith("/workspace/tsconfig.json");
    });

    it("returns false when tsconfig.json is missing", async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const result = await typescriptPlugin.detect("/workspace");
      expect(result).toBe(false);
    });
  });

  describe("typecheck parseOutput", () => {
    const parse = typescriptPlugin.checks.typecheck!.parseOutput;

    it("reports success when exit code is 0", () => {
      const result = parse("", "", 0);
      expect(result.passed).toBe(true);
      expect(result.errorCount).toBe(0);
    });

    it("counts errors from stderr", () => {
      const stderr = [
        "src/index.ts(5,3): error TS2322: Type 'string' is not assignable to type 'number'.",
        "src/api.ts(12,7): error TS2345: Argument of type 'null' is not assignable.",
      ].join("\n");
      const result = parse("", stderr, 2);
      expect(result.passed).toBe(false);
      expect(result.errorCount).toBe(2);
      expect(result.summary).toBe("2 type errors");
      expect(result.details).toBe(stderr);
    });

    it("handles single error grammar", () => {
      const stderr = "src/index.ts(1,1): error TS2322: Type mismatch.";
      const result = parse("", stderr, 2);
      expect(result.errorCount).toBe(1);
      expect(result.summary).toBe("1 type error");
    });
  });

  describe("lint parseOutput", () => {
    const parse = typescriptPlugin.checks.lint!.parseOutput;

    it("reports success when exit code is 0", () => {
      const result = parse("", "", 0);
      expect(result.passed).toBe(true);
    });

    it("counts problems from eslint output", () => {
      const stdout = "\n✖ 5 problems (3 errors, 2 warnings)\n";
      const result = parse(stdout, "", 1);
      expect(result.passed).toBe(false);
      expect(result.errorCount).toBe(3);
      expect(result.warningCount).toBe(2);
      expect(result.summary).toBe("3 errors, 2 warnings");
    });
  });

  describe("test parseOutput", () => {
    const parse = typescriptPlugin.checks.test!.parseOutput;

    it("reports success when exit code is 0", () => {
      const stdout = " Tests  12 passed (12)\n";
      const result = parse(stdout, "", 0);
      expect(result.passed).toBe(true);
      expect(result.summary).toContain("12 passed");
    });

    it("reports failures", () => {
      const stdout = " Tests  3 failed | 9 passed (12)\n";
      const result = parse(stdout, "", 1);
      expect(result.passed).toBe(false);
      expect(result.errorCount).toBe(3);
      expect(result.summary).toContain("3 failed");
    });
  });

  describe("build parseOutput", () => {
    const parse = typescriptPlugin.checks.build!.parseOutput;

    it("reports success when exit code is 0", () => {
      const result = parse("", "", 0);
      expect(result.passed).toBe(true);
      expect(result.summary).toBe("Build succeeded");
    });

    it("reports failure with error count", () => {
      const stderr = "src/a.ts(1,1): error TS1234: Something.\nsrc/b.ts(2,2): error TS5678: Other.";
      const result = parse("", stderr, 1);
      expect(result.passed).toBe(false);
      expect(result.errorCount).toBe(2);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && bun run test -- tests/gate-plugins.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the TypeScript plugin**

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && bun run test -- tests/gate-plugins.test.ts`
Expected: All 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/cycles/plugins/typescript.ts packages/server/tests/gate-plugins.test.ts
git commit -m "feat: add TypeScript language gate plugin with output parsers"
```

---

### Task 3: Plugin Registry

**Files:**
- Create: `packages/server/src/cycles/plugins/index.ts`

- [ ] **Step 1: Add registry tests to existing test file**

Append to `packages/server/tests/gate-plugins.test.ts`:

```typescript
import { registerPlugin, getPlugin, detectLanguage } from "../src/cycles/plugins/index.js";

describe("Plugin Registry", () => {
  it("registers and retrieves a plugin by language", () => {
    const plugin = getPlugin("typescript");
    expect(plugin).toBeDefined();
    expect(plugin!.language).toBe("typescript");
  });

  it("returns undefined for unknown language", () => {
    expect(getPlugin("cobol")).toBeUndefined();
  });

  it("detects language from workspace", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const lang = await detectLanguage("/workspace");
    expect(lang).toBe("typescript");
  });

  it("returns undefined when no language detected", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const lang = await detectLanguage("/workspace");
    expect(lang).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `cd packages/server && bun run test -- tests/gate-plugins.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the registry**

```typescript
// packages/server/src/cycles/plugins/index.ts
import type { LanguageGatePlugin } from "./types.js";
import { typescriptPlugin } from "./typescript.js";

export type { LanguageGatePlugin, GateCommand, GateCheckResult, GateCheckType } from "./types.js";

const plugins: Map<string, LanguageGatePlugin> = new Map();

export function registerPlugin(plugin: LanguageGatePlugin): void {
  plugins.set(plugin.language, plugin);
}

export function getPlugin(language: string): LanguageGatePlugin | undefined {
  return plugins.get(language);
}

/** Try each registered plugin's detect() and return the first match */
export async function detectLanguage(workspacePath: string): Promise<string | undefined> {
  for (const plugin of plugins.values()) {
    if (await plugin.detect(workspacePath)) {
      return plugin.language;
    }
  }
  return undefined;
}

// Register built-in plugins
registerPlugin(typescriptPlugin);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && bun run test -- tests/gate-plugins.test.ts`
Expected: All 14 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/cycles/plugins/index.ts packages/server/tests/gate-plugins.test.ts
git commit -m "feat: add language gate plugin registry with auto-detection"
```

---

### Task 4: Gate Runner

**Files:**
- Create: `packages/server/src/cycles/gates.ts`
- Test: `packages/server/tests/gate-runner.test.ts`

- [ ] **Step 1: Write failing tests for the gate runner**

```typescript
// packages/server/tests/gate-runner.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import { runGateCheck, runGateChecks } from "../src/cycles/gates.js";
import type { GateCheckResult } from "../src/cycles/plugins/types.js";

describe("Gate Runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("runGateCheck", () => {
    it("runs a typecheck and returns parsed result on success", async () => {
      vi.mocked(execFileSync).mockReturnValue(Buffer.from(""));
      const result = await runGateCheck("typecheck", "typescript", "/workspace");
      expect(result.passed).toBe(true);
      expect(execFileSync).toHaveBeenCalledWith(
        "npx",
        ["tsc", "--noEmit"],
        expect.objectContaining({ cwd: "/workspace", stdio: "pipe" })
      );
    });

    it("returns parsed failure when command exits non-zero", async () => {
      const error = new Error("Command failed") as any;
      error.status = 2;
      error.stdout = Buffer.from("");
      error.stderr = Buffer.from("src/a.ts(1,1): error TS2322: Type mismatch.");
      vi.mocked(execFileSync).mockImplementation(() => { throw error; });

      const result = await runGateCheck("typecheck", "typescript", "/workspace");
      expect(result.passed).toBe(false);
      expect(result.errorCount).toBe(1);
    });

    it("throws for unknown language", async () => {
      await expect(runGateCheck("typecheck", "cobol", "/workspace"))
        .rejects.toThrow("No gate plugin registered for language: cobol");
    });

    it("throws for unsupported check type", async () => {
      await expect(runGateCheck("build", "typescript", "/workspace"))
        .resolves.toBeDefined(); // typescript supports build
    });
  });

  describe("runGateChecks", () => {
    it("runs multiple checks and returns all results", async () => {
      vi.mocked(execFileSync).mockReturnValue(Buffer.from(""));
      const results = await runGateChecks(
        [
          { type: "typecheck", language: "typescript" },
          { type: "lint", language: "typescript" },
        ],
        "/workspace"
      );
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.passed)).toBe(true);
    });

    it("returns all results even if some fail", async () => {
      let callCount = 0;
      vi.mocked(execFileSync).mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Buffer.from(""); // typecheck passes
        const error = new Error("lint failed") as any;
        error.status = 1;
        error.stdout = Buffer.from("\n✖ 2 problems (2 errors, 0 warnings)\n");
        error.stderr = Buffer.from("");
        throw error;
      });

      const results = await runGateChecks(
        [
          { type: "typecheck", language: "typescript" },
          { type: "lint", language: "typescript" },
        ],
        "/workspace"
      );
      expect(results[0].passed).toBe(true);
      expect(results[1].passed).toBe(false);
    });

    it("runs custom checks via shell command", async () => {
      vi.mocked(execFileSync).mockReturnValue(Buffer.from("ok"));
      const results = await runGateChecks(
        [{ type: "custom", language: "typescript", command: "npm run custom-check" }],
        "/workspace"
      );
      expect(results).toHaveLength(1);
      expect(results[0].passed).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && bun run test -- tests/gate-runner.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the gate runner**

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && bun run test -- tests/gate-runner.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/cycles/gates.ts packages/server/tests/gate-runner.test.ts
git commit -m "feat: add gate runner for executing language-specific quality checks"
```

---

## Sub-Project 2: Blueprint Engine Core

### Task 5: Cycle Type Definitions + Prisma Schema

**Files:**
- Create: `packages/server/src/cycles/types.ts`
- Modify: `packages/server/prisma/schema.prisma`

- [ ] **Step 1: Create cycle type definitions**

```typescript
// packages/server/src/cycles/types.ts
import type { GateCheckType } from "./plugins/types.js";

export interface TriggerConfig {
  keywords: string[];
  issueLabels?: string[];
}

export interface GateCheck {
  type: GateCheckType;
  language: string;
  command?: string;
}

export interface Gate {
  checks: GateCheck[];
  onFail: "retry" | "block" | "notify";
}

export interface BlueprintNode {
  id: string;
  name: string;
  type: "agentic" | "deterministic";
  prompt?: string;
  tools?: string[];
  gate?: Gate;
  maxIterations?: number;
  retryFromNodeId?: string;
  skipCondition?: string;
}

export interface Blueprint {
  id: string;
  name: string;
  description: string;
  trigger: TriggerConfig;
  nodes: BlueprintNode[];
}

export interface NodeResultState {
  nodeId: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  iterations: number;
  gateResults?: Array<{
    type: string;
    passed: boolean;
    summary: string;
    details?: string;
    errorCount?: number;
    warningCount?: number;
  }>;
  startedAt?: Date;
  completedAt?: Date;
}

export interface CycleRunState {
  id: string;
  threadId: string;
  blueprintId: string;
  currentNodeIndex: number;
  status: "running" | "gate_failed" | "completed" | "failed";
  nodeResults: NodeResultState[];
  startedAt: Date;
  completedAt?: Date;
}

/** Predefined skip condition flags */
export interface SkipContext {
  isSmallTask: boolean;
  isAutonomous: boolean;
  hasExistingTests: boolean;
  hasPrDiff: boolean;
}
```

- [ ] **Step 2: Add Prisma models**

Add to `packages/server/prisma/schema.prisma`, after existing models. Also add `cycleRuns CycleRun[]` relation to the `Thread` model.

```prisma
model CycleRun {
  id               String            @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  threadId         String            @map("thread_id") @db.Uuid
  thread           Thread            @relation(fields: [threadId], references: [id], onDelete: Cascade)
  blueprintId      String            @map("blueprint_id") @db.VarChar(50)
  currentNodeIndex Int               @default(0) @map("current_node_index")
  status           String            @default("running") @db.VarChar(20)
  startedAt        DateTime          @default(now()) @map("started_at") @db.Timestamptz
  completedAt      DateTime?         @map("completed_at") @db.Timestamptz
  nodeResults      CycleNodeResult[]

  @@index([threadId])
  @@index([status])
  @@map("cycle_run")
}

model CycleNodeResult {
  id          String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  cycleRunId  String    @map("cycle_run_id") @db.Uuid
  cycleRun    CycleRun  @relation(fields: [cycleRunId], references: [id], onDelete: Cascade)
  nodeId      String    @map("node_id") @db.VarChar(50)
  status      String    @default("pending") @db.VarChar(20)
  iterations  Int       @default(0)
  gateResults Json?     @map("gate_results")
  startedAt   DateTime? @map("started_at") @db.Timestamptz
  completedAt DateTime? @map("completed_at") @db.Timestamptz

  @@index([cycleRunId])
  @@map("cycle_node_result")
}
```

- [ ] **Step 3: Push schema to database**

Run: `cd packages/server && DATABASE_URL="postgresql://patchwork:patchwork@localhost:5433/patchwork" bunx prisma db push`
Expected: Schema synced successfully

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/cycles/types.ts packages/server/prisma/schema.prisma
git commit -m "feat: add cycle type definitions and Prisma models for CycleRun"
```

---

### Task 6: Cycle Event Types

**Files:**
- Create: `packages/server/src/cycles/events.ts`
- Modify: `packages/server/src/providers/events.ts`

- [ ] **Step 1: Create cycle event types**

```typescript
// packages/server/src/cycles/events.ts

export type CycleEvent =
  | { type: "cycle.started"; blueprintId: string; runId: string; blueprintName: string }
  | { type: "cycle.completed"; runId: string; status: string; durationMs: number }
  | { type: "cycle.failed"; runId: string; nodeId: string; reason: string }
  | { type: "phase.started"; nodeId: string; nodeName: string; nodeType: "agentic" | "deterministic"; index: number; total: number }
  | { type: "phase.completed"; nodeId: string; status: string }
  | { type: "phase.skipped"; nodeId: string; reason: string }
  | { type: "gate.running"; checkType: string; language: string }
  | { type: "gate.result"; checkType: string; passed: boolean; summary: string; details?: string; errorCount?: number; warningCount?: number };
```

- [ ] **Step 2: Extend the provider events type union**

Read `packages/server/src/providers/events.ts` and add cycle event types to the `ProviderRuntimeEvent` union. Add these as additional union members:

```typescript
| { type: "cycle.started"; payload: { blueprintId: string; runId: string; blueprintName: string } }
| { type: "cycle.completed"; payload: { runId: string; status: string; durationMs: number } }
| { type: "cycle.failed"; payload: { runId: string; nodeId: string; reason: string } }
| { type: "phase.started"; payload: { nodeId: string; nodeName: string; nodeType: string; index: number; total: number } }
| { type: "phase.completed"; payload: { nodeId: string; status: string } }
| { type: "phase.skipped"; payload: { nodeId: string; reason: string } }
| { type: "gate.running"; payload: { checkType: string; language: string } }
| { type: "gate.result"; payload: { checkType: string; passed: boolean; summary: string; details?: string; errorCount?: number; warningCount?: number } }
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/cycles/events.ts packages/server/src/providers/events.ts
git commit -m "feat: add cycle event types and extend provider event union"
```

---

### Task 7: Blueprint Engine

**Files:**
- Create: `packages/server/src/cycles/engine.ts`
- Test: `packages/server/tests/cycle-engine.test.ts`

- [ ] **Step 1: Write failing tests for the engine**

```typescript
// packages/server/tests/cycle-engine.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/db/prisma.js", () => ({
  default: {
    cycleRun: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
    },
    cycleNodeResult: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock("../src/cycles/gates.js", () => ({
  runGateChecks: vi.fn().mockResolvedValue([]),
}));

import prisma from "../src/db/prisma.js";
import { runGateChecks } from "../src/cycles/gates.js";
import { CycleEngine } from "../src/cycles/engine.js";
import type { Blueprint, SkipContext } from "../src/cycles/types.js";

const simpleBp: Blueprint = {
  id: "test-cycle",
  name: "Test Cycle",
  description: "A test blueprint",
  trigger: { keywords: [] },
  nodes: [
    { id: "implement", name: "Implement", type: "agentic" },
    {
      id: "typecheck",
      name: "Typecheck",
      type: "deterministic",
      gate: { checks: [{ type: "typecheck", language: "typescript" }], onFail: "retry" },
    },
    { id: "fix", name: "Fix", type: "agentic", maxIterations: 2, retryFromNodeId: "typecheck" },
  ],
};

const emitMock = vi.fn();

describe("CycleEngine", () => {
  let engine: CycleEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.cycleRun.create).mockResolvedValue({ id: "run-1" } as any);
    vi.mocked(prisma.cycleRun.update).mockResolvedValue({} as any);
    vi.mocked(prisma.cycleNodeResult.create).mockResolvedValue({} as any);
    vi.mocked(prisma.cycleNodeResult.update).mockResolvedValue({} as any);
    engine = new CycleEngine(emitMock);
  });

  describe("startCycle", () => {
    it("creates a CycleRun and emits cycle.started", async () => {
      const run = await engine.startCycle(simpleBp, "thread-1", "/workspace");
      expect(prisma.cycleRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ blueprintId: "test-cycle", threadId: "thread-1" }),
        })
      );
      expect(emitMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "cycle.started" })
      );
    });
  });

  describe("advanceToNextNode", () => {
    it("advances past completed agentic node", async () => {
      vi.mocked(prisma.cycleRun.findFirst).mockResolvedValue({
        id: "run-1",
        blueprintId: "test-cycle",
        currentNodeIndex: 0,
        status: "running",
        threadId: "thread-1",
      } as any);

      const result = await engine.advanceAgenticNode("run-1", simpleBp, "/workspace");
      expect(result.nextNode?.id).toBe("typecheck");
    });
  });

  describe("runDeterministicNode", () => {
    it("runs gate checks and advances on success", async () => {
      vi.mocked(runGateChecks).mockResolvedValue([{ passed: true, summary: "OK" }]);

      const result = await engine.runDeterministicNode("run-1", simpleBp, 1, "/workspace");
      expect(result.passed).toBe(true);
      expect(runGateChecks).toHaveBeenCalled();
    });

    it("triggers fix loop on gate failure with retry", async () => {
      vi.mocked(runGateChecks).mockResolvedValue([{ passed: false, summary: "2 errors", errorCount: 2 }]);

      const result = await engine.runDeterministicNode("run-1", simpleBp, 1, "/workspace");
      expect(result.passed).toBe(false);
      expect(result.action).toBe("retry");
      expect(result.fixNodeId).toBe("fix");
    });
  });

  describe("fix loop iteration tracking", () => {
    it("stops after maxIterations", async () => {
      vi.mocked(runGateChecks).mockResolvedValue([{ passed: false, summary: "failing" }]);
      vi.mocked(prisma.cycleNodeResult.findMany).mockResolvedValue([
        { nodeId: "fix", iterations: 2 } as any,
      ]);

      const result = await engine.runDeterministicNode("run-1", simpleBp, 1, "/workspace");
      expect(result.action).toBe("halt");
    });
  });

  describe("skipCondition", () => {
    it("skips nodes when condition is met", () => {
      const skipCtx: SkipContext = { isSmallTask: true, isAutonomous: false, hasExistingTests: false, hasPrDiff: false };
      const node = { id: "spec", name: "Spec", type: "agentic" as const, skipCondition: "isSmallTask" };
      expect(engine.shouldSkip(node, skipCtx)).toBe(true);
    });

    it("does not skip when condition is not met", () => {
      const skipCtx: SkipContext = { isSmallTask: false, isAutonomous: false, hasExistingTests: false, hasPrDiff: false };
      const node = { id: "spec", name: "Spec", type: "agentic" as const, skipCondition: "isSmallTask" };
      expect(engine.shouldSkip(node, skipCtx)).toBe(false);
    });
  });

  describe("completeCycle", () => {
    it("marks cycle as completed", async () => {
      await engine.completeCycle("run-1");
      expect(prisma.cycleRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "run-1" },
          data: expect.objectContaining({ status: "completed" }),
        })
      );
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && bun run test -- tests/cycle-engine.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the engine**

Create `packages/server/src/cycles/engine.ts`. The engine should:
- `startCycle(blueprint, threadId, workspacePath)` — creates CycleRun + node results, emits `cycle.started`
- `advanceAgenticNode(runId, blueprint, workspacePath)` — marks current agentic node done, returns next node
- `runDeterministicNode(runId, blueprint, nodeIndex, workspacePath)` — runs gate checks, returns `{ passed, action: "advance" | "retry" | "halt" | "notify", fixNodeId? }`
- `shouldSkip(node, skipCtx)` — evaluates predefined skip flags
- `completeCycle(runId)` — marks run as completed with timestamp
- `failCycle(runId, nodeId, reason)` — marks run as gate_failed
- `getPhasePrompt(blueprint, nodeIndex)` — returns system prompt fragment for agentic node
- Uses `emitFn` callback for all event emission (injected, not hardcoded)

Key implementation details:
- Fix loop: when gate fails with `onFail: "retry"`, find the next node. Check if it has `maxIterations`. Look up current iteration count from `CycleNodeResult`. If under max, return `action: "retry"` with `fixNodeId`. If at max, return `action: "halt"`.
- `retryFromNodeId`: when returning from a fix, the engine jumps back to the node referenced by `retryFromNodeId` and re-runs from there.
- Skip conditions: simple lookup into `SkipContext` record by flag name.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && bun run test -- tests/cycle-engine.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/cycles/engine.ts packages/server/tests/cycle-engine.test.ts
git commit -m "feat: add blueprint cycle engine with state machine and fix loops"
```

---

### Task 8: Hardcoded Blueprint Definitions

**Files:**
- Create: `packages/server/src/cycles/blueprints.ts`
- Test: `packages/server/tests/cycle-blueprints.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/server/tests/cycle-blueprints.test.ts
import { describe, it, expect } from "vitest";
import { getBlueprint, getAllBlueprints } from "../src/cycles/blueprints.js";

describe("Hardcoded Blueprints", () => {
  it("has exactly 4 blueprints", () => {
    expect(getAllBlueprints()).toHaveLength(4);
  });

  it("can retrieve each by id", () => {
    expect(getBlueprint("feature-dev")).toBeDefined();
    expect(getBlueprint("debug")).toBeDefined();
    expect(getBlueprint("code-review")).toBeDefined();
    expect(getBlueprint("production-check")).toBeDefined();
  });

  it("returns undefined for unknown id", () => {
    expect(getBlueprint("unknown")).toBeUndefined();
  });

  describe("feature-dev", () => {
    it("has correct node sequence", () => {
      const bp = getBlueprint("feature-dev")!;
      const nodeIds = bp.nodes.map((n) => n.id);
      expect(nodeIds).toEqual([
        "spec", "plan", "write-tests", "implement",
        "typecheck", "lint", "run-tests", "fix", "review", "commit",
      ]);
    });

    it("has spec and plan with skipCondition isSmallTask", () => {
      const bp = getBlueprint("feature-dev")!;
      expect(bp.nodes[0].skipCondition).toBe("isSmallTask");
      expect(bp.nodes[1].skipCondition).toBe("isSmallTask");
    });

    it("has fix node with retryFromNodeId and maxIterations", () => {
      const bp = getBlueprint("feature-dev")!;
      const fix = bp.nodes.find((n) => n.id === "fix")!;
      expect(fix.retryFromNodeId).toBe("typecheck");
      expect(fix.maxIterations).toBe(2);
    });

    it("has deterministic gate nodes", () => {
      const bp = getBlueprint("feature-dev")!;
      const typecheck = bp.nodes.find((n) => n.id === "typecheck")!;
      expect(typecheck.type).toBe("deterministic");
      expect(typecheck.gate).toBeDefined();
      expect(typecheck.gate!.checks[0].type).toBe("typecheck");
    });
  });

  describe("all blueprints", () => {
    it("every blueprint has trigger keywords", () => {
      for (const bp of getAllBlueprints()) {
        expect(bp.trigger.keywords.length, `${bp.id} missing keywords`).toBeGreaterThan(0);
      }
    });

    it("every fix node has retryFromNodeId pointing to a valid node", () => {
      for (const bp of getAllBlueprints()) {
        for (const node of bp.nodes) {
          if (node.retryFromNodeId) {
            const target = bp.nodes.find((n) => n.id === node.retryFromNodeId);
            expect(target, `${bp.id}.${node.id} retryFromNodeId references missing node`).toBeDefined();
          }
        }
      }
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && bun run test -- tests/cycle-blueprints.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the blueprints**

Create `packages/server/src/cycles/blueprints.ts` with:
- `featureDevBlueprint` — 10 nodes (spec, plan, write-tests, implement, typecheck, lint, run-tests, fix, review, commit). Spec+plan have `skipCondition: "isSmallTask"`. Typecheck/lint/run-tests are deterministic with gates. Fix has `maxIterations: 2, retryFromNodeId: "typecheck"`.
- `debugBlueprint` — 10 nodes (reproduce, isolate, regression-test, fix, typecheck, lint, run-tests, fix-loop, review, commit)
- `codeReviewBlueprint` — 7 nodes (analyze-diff, typecheck, lint, run-tests, pattern-review, security-review, report). Gates use `onFail: "notify"`.
- `productionCheckBlueprint` — 6 nodes (full-test-suite, typecheck, lint, build, smoke-test, report). Gates use `onFail: "block"`.
- `getBlueprint(id)` and `getAllBlueprints()` functions.
- Each agentic node has a `prompt` field with phase-specific instructions.
- Each blueprint has `trigger.keywords` matching the spec.

Follow the spec exactly for node definitions (Section: The Four Hardcoded Cycles).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && bun run test -- tests/cycle-blueprints.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/cycles/blueprints.ts packages/server/tests/cycle-blueprints.test.ts
git commit -m "feat: add four hardcoded blueprint cycle definitions"
```

---

### Task 9: Cycle REST API

**Files:**
- Create: `packages/server/src/api/cycles.ts`
- Test: `packages/server/tests/cycle-api.test.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/server/tests/cycle-api.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import type { Express } from "express";

vi.mock("../src/db/prisma.js", () => ({
  default: {
    cycleRun: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    cycleNodeResult: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

import prisma from "../src/db/prisma.js";
import { cyclesRouter } from "../src/api/cycles.js";

function buildApp(userId?: string): Express {
  const app = express();
  if (userId) {
    app.use((req, _res, next) => {
      (req as any).user = { id: userId };
      next();
    });
  }
  app.use(express.json());
  app.use("/api/threads/:threadId/cycle", cyclesRouter());
  return app;
}

describe("Cycles API", () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = buildApp("user-1");
  });

  describe("GET /api/threads/:threadId/cycle", () => {
    it("returns 404 when no active cycle", async () => {
      const res = await request(app).get("/api/threads/thread-1/cycle");
      expect(res.status).toBe(404);
    });

    it("returns active cycle run with node results", async () => {
      vi.mocked(prisma.cycleRun.findFirst).mockResolvedValueOnce({
        id: "run-1",
        blueprintId: "feature-dev",
        currentNodeIndex: 2,
        status: "running",
        startedAt: new Date(),
        nodeResults: [
          { nodeId: "spec", status: "passed" },
          { nodeId: "plan", status: "passed" },
          { nodeId: "write-tests", status: "running" },
        ],
      } as any);

      const res = await request(app).get("/api/threads/thread-1/cycle");
      expect(res.status).toBe(200);
      expect(res.body.blueprintId).toBe("feature-dev");
      expect(res.body.nodeResults).toHaveLength(3);
    });
  });

  describe("GET /api/threads/:threadId/cycle/history", () => {
    it("returns all cycle runs for a thread", async () => {
      vi.mocked(prisma.cycleRun.findMany).mockResolvedValueOnce([
        { id: "run-1", blueprintId: "feature-dev", status: "completed" },
        { id: "run-2", blueprintId: "code-review", status: "completed" },
      ] as any);

      const res = await request(app).get("/api/threads/thread-1/cycle/history");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && bun run test -- tests/cycle-api.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the cycles router**

```typescript
// packages/server/src/api/cycles.ts
import { Router } from "express";
import prisma from "../db/prisma.js";

export function cyclesRouter(): Router {
  const r = Router({ mergeParams: true });

  // Get active cycle for a thread
  r.get("/", async (req, res) => {
    try {
      const { threadId } = req.params as any;

      const run = await prisma.cycleRun.findFirst({
        where: { threadId, status: "running" },
        include: { nodeResults: { orderBy: { startedAt: "asc" } } },
      });

      if (!run) return res.status(404).json({ error: "No active cycle" });
      res.json(run);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get cycle run history for a thread
  r.get("/history", async (req, res) => {
    try {
      const { threadId } = req.params as any;

      const runs = await prisma.cycleRun.findMany({
        where: { threadId },
        include: { nodeResults: { orderBy: { startedAt: "asc" } } },
        orderBy: { startedAt: "desc" },
      });

      res.json(runs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return r;
}
```

- [ ] **Step 4: Mount the router in index.ts**

Add to `packages/server/src/index.ts`:

```typescript
import { cyclesRouter } from "./api/cycles.js";
// ... mount alongside other routes
app.use("/api/threads/:threadId/cycle", cyclesRouter());
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/server && bun run test -- tests/cycle-api.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/api/cycles.ts packages/server/tests/cycle-api.test.ts packages/server/src/index.ts
git commit -m "feat: add cycle status REST API endpoints"
```

---

## Sub-Project 3: Hardcoded Cycles + MCP Tools

### Task 10: Cycle MCP Tools

**Files:**
- Modify: `packages/server/src/providers/claude-code/custom-tools.ts`

- [ ] **Step 1: Read existing custom-tools.ts to understand the MCP tool pattern**

Reference: `packages/server/src/providers/claude-code/custom-tools.ts` — follow the same `tool()` pattern used for anki tools.

- [ ] **Step 2: Add four cycle MCP tools**

Add to the MCP server in `custom-tools.ts`:

**`cycle_start`** — `{ blueprintId: string }` → Creates CycleRun via engine, injects phase prompt. Validates blueprintId against registered blueprints. Returns `{ runId, currentPhase, totalPhases }`.

**`cycle_status`** — `{}` → Returns current cycle state: `{ blueprintId, currentPhase, phaseIndex, totalPhases, status, nodeResults }`. Returns `{ active: false }` if no cycle running.

**`cycle_advance`** — `{}` → Agent signals current agentic phase is done. Engine advances to next node. If next is deterministic, engine runs it automatically and returns gate results. Returns `{ nextPhase, gateResults? }`.

**`cycle_skip`** — `{ nodeId: string, reason: string }` → Skip a pending phase. Must be the current or future node. Returns `{ skipped: true }`.

Each tool should:
- Use `ctx.projectId` and `ctx.threadId` from the MCP context (same pattern as anki tools)
- Import and use `CycleEngine` from `../cycles/engine.js`
- Import `getBlueprint` from `../cycles/blueprints.js`
- Emit events via the engine's emit function

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/providers/claude-code/custom-tools.ts
git commit -m "feat: add cycle MCP tools (start, status, advance, skip)"
```

---

### Task 11: System Prompt Cycle Injection

**Files:**
- Modify: `packages/server/src/providers/claude-code/adapter.ts`

- [ ] **Step 1: Read adapter.ts to understand existing injection patterns**

Reference the Anki TOC injection pattern (~line 402-462).

- [ ] **Step 2: Add cycle prompt injection**

In the `sendTurn` method, after the Anki TOC section, add cycle prompt injection:

1. Query for active CycleRun for this thread
2. If a cycle is active:
   - Look up the blueprint definition
   - Get the current node
   - If current node is agentic, build phase-specific prompt from `node.prompt`
   - Build cycle status overview (phase progression dots)
   - Append to system prompt (same pattern as ankiTocSection)
3. Include the available cycles section in system prompt for all threads:

```
# Development Cycles

You have access to structured development cycles that enforce quality gates.
When a task matches a cycle, announce it and activate it using the `cycle_start` tool.

Available cycles:
- **feature-dev**: New features, enhancements, refactors
- **debug**: Bug fixes, error investigation
- **code-review**: Review existing code/PR
- **production-check**: Pre-deploy verification

When activating a cycle, use `cycle_start` with the cycle ID.
For small/routine tasks, you may skip spec and plan phases via `cycle_skip`.
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/providers/claude-code/adapter.ts
git commit -m "feat: inject cycle phase prompt into agent system prompt"
```

---

### Task 12: Commit-Blocking Hook

**Files:**
- Modify: `packages/server/src/providers/claude-code/hooks.ts`

- [ ] **Step 1: Read hooks.ts to understand PreToolUse pattern**

Reference: The existing `PreToolUse` handler that blocks dangerous commands.

- [ ] **Step 2: Add cycle gate enforcement hook**

In the `PreToolUse` array, add a handler that:
1. Checks if `tool_name === "Bash"` and the command contains `git commit`
2. If so, queries for an active CycleRun on this thread
3. If a cycle is active and the current node is before the commit node:
   - Check if all deterministic gate nodes have passed
   - If gates haven't all passed, deny the commit with a message: "Cannot commit — cycle gates not yet passed. Current phase: {phase}. Use cycle_advance to progress through remaining phases."
4. If no active cycle, allow the commit normally

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/providers/claude-code/hooks.ts
git commit -m "feat: add PreToolUse hook to block commits when cycle gates pending"
```

---

## Sub-Project 4: UI — Cycle Visualization

### Task 13: Cycle Status Bar Component

**Files:**
- Create: `packages/ui/src/components/thread/cycle-status-bar.tsx`

- [ ] **Step 1: Create the CycleStatusBar component**

A compact bar showing:
- Blueprint name (e.g. "Feature Development")
- Current phase name and index (e.g. "Implement (4/10)")
- Progress bar (filled segments for completed, pulse for active, empty for pending)
- Phase dots: green ✓ (passed), blue pulse ● (running), gray ○ (pending), red ✗ (failed), skip ⊘ (skipped)

Props:
```typescript
interface CycleStatusBarProps {
  blueprintName: string;
  nodes: Array<{
    id: string;
    name: string;
    status: "pending" | "running" | "passed" | "failed" | "skipped";
  }>;
  currentIndex: number;
  status: "running" | "completed" | "gate_failed" | "failed";
  durationMs?: number;
}
```

Use the existing zinc palette and styling patterns from the project. The bar should:
- Only render when a cycle is active
- Use a border-b to separate from the timeline below
- Show compact phase names (single word abbreviations)
- Pulse animation on the active phase dot (similar to existing loading spinners)

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/thread/cycle-status-bar.tsx
git commit -m "feat: add CycleStatusBar component for cycle progress visualization"
```

---

### Task 14: Gate Result Component

**Files:**
- Create: `packages/ui/src/components/thread/gate-result.tsx`

- [ ] **Step 1: Create the GateResult component**

An expandable card showing gate check results. Similar styling to `work-item.tsx`.

Props:
```typescript
interface GateResultProps {
  checkType: string;             // "typecheck", "lint", "test", "build"
  passed: boolean;
  summary: string;
  details?: string;
  errorCount?: number;
  warningCount?: number;
}
```

Behavior:
- Collapsed: shows check type icon + pass/fail badge + summary text
- Expanded: shows full details in a monospace pre block
- Failed gates auto-expand
- Color: green border for passed, red border for failed
- Icons: CheckCircle2 for pass, XCircle for fail

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/thread/gate-result.tsx
git commit -m "feat: add GateResult component for expandable gate check display"
```

---

### Task 15: Timeline Integration

**Files:**
- Modify: `packages/ui/src/components/thread/timeline.tsx`
- Modify: `packages/ui/src/app/projects/[projectId]/threads/[id]/page.tsx`
- Modify: `packages/ui/src/lib/api.ts`

- [ ] **Step 1: Add new timeline item kinds to TimelineItem type**

In `timeline.tsx`, add to the `kind` union: `"phase_transition" | "gate_result" | "cycle_summary"`

Add fields to `TimelineItem`:
```typescript
/** Gate result data */
checkType?: string;
gatePassed?: boolean;
gateSummary?: string;
gateDetails?: string;
gateErrorCount?: number;
gateWarningCount?: number;
/** Phase transition data */
phaseIndex?: number;
phaseTotal?: number;
phaseNodeType?: string;
/** Cycle summary data */
cycleDurationMs?: number;
cycleNodes?: Array<{ id: string; name: string; status: string }>;
```

- [ ] **Step 2: Add rendering cases in the timeline switch**

Add cases for the three new kinds:

**`phase_transition`**: Render as a divider (same style as `context_compacted`):
```tsx
<div className="flex items-center gap-3 max-w-3xl mx-auto py-1">
  <div className="flex-1 border-t border-dashed border-violet-500/20" />
  <span className="text-[10px] font-mono text-violet-400/60">
    Phase: {item.content} ({item.phaseIndex}/{item.phaseTotal})
  </span>
  <div className="flex-1 border-t border-dashed border-violet-500/20" />
</div>
```

**`gate_result`**: Render with `<GateResult>` component

**`cycle_summary`**: Render as a completion card with phase dots and duration

- [ ] **Step 3: Mount CycleStatusBar in thread detail page**

In `page.tsx`, add state for cycle data. Subscribe to cycle events from the WebSocket stream. Render `<CycleStatusBar>` above the `<Timeline>` when a cycle is active.

- [ ] **Step 4: Add cycle API methods to api.ts**

```typescript
async getCycleStatus(threadId: string): Promise<CycleRun | null> { ... }
async getCycleHistory(threadId: string): Promise<CycleRun[]> { ... }
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/thread/timeline.tsx packages/ui/src/components/thread/gate-result.tsx packages/ui/src/app/projects/\[projectId\]/threads/\[id\]/page.tsx packages/ui/src/lib/api.ts
git commit -m "feat: integrate cycle visualization into thread timeline and status bar"
```

---

## Sub-Project 5: Cycle Detection + Dispatch Integration

### Task 16: Custom Cycle Config Loader

**Files:**
- Create: `packages/server/src/cycles/loader.ts`
- Test: `packages/server/tests/cycle-loader.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/server/tests/cycle-loader.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readdirSync: vi.fn().mockReturnValue([]),
  readFileSync: vi.fn(),
}));

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { loadCustomCycles, validateBlueprint } from "../src/cycles/loader.js";

describe("Custom Cycle Loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("loadCustomCycles", () => {
    it("returns empty array when directory doesn't exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      expect(loadCustomCycles("/workspace")).toEqual([]);
    });

    it("loads valid cycle configs", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue(["migration.json"] as any);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        id: "migration",
        name: "Migration",
        description: "DB migration",
        trigger: { keywords: ["migrate"] },
        nodes: [
          { id: "plan", name: "Plan", type: "agentic" },
          { id: "commit", name: "Commit", type: "deterministic" },
        ],
      }));

      const cycles = loadCustomCycles("/workspace");
      expect(cycles).toHaveLength(1);
      expect(cycles[0].id).toBe("migration");
    });

    it("skips invalid configs", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue(["bad.json"] as any);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ id: "bad" })); // missing required fields

      const cycles = loadCustomCycles("/workspace");
      expect(cycles).toEqual([]);
    });

    it("skips configs that collide with hardcoded IDs", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue(["override.json"] as any);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        id: "feature-dev", // collides!
        name: "Override",
        description: "Trying to override",
        trigger: { keywords: ["test"] },
        nodes: [{ id: "a", name: "A", type: "agentic" }],
      }));

      const cycles = loadCustomCycles("/workspace");
      expect(cycles).toEqual([]);
    });
  });

  describe("validateBlueprint", () => {
    it("rejects missing required fields", () => {
      expect(validateBlueprint({ id: "x" } as any)).not.toBeNull();
    });

    it("rejects duplicate node IDs", () => {
      const bp = {
        id: "test", name: "Test", description: "T", trigger: { keywords: ["t"] },
        nodes: [
          { id: "dup", name: "A", type: "agentic" },
          { id: "dup", name: "B", type: "agentic" },
        ],
      };
      expect(validateBlueprint(bp as any)).toContain("duplicate");
    });

    it("rejects maxIterations out of range", () => {
      const bp = {
        id: "test", name: "Test", description: "T", trigger: { keywords: ["t"] },
        nodes: [{ id: "fix", name: "Fix", type: "agentic", maxIterations: 10 }],
      };
      expect(validateBlueprint(bp as any)).toContain("maxIterations");
    });

    it("rejects retryFromNodeId referencing non-existent node", () => {
      const bp = {
        id: "test", name: "Test", description: "T", trigger: { keywords: ["t"] },
        nodes: [{ id: "fix", name: "Fix", type: "agentic", retryFromNodeId: "missing" }],
      };
      expect(validateBlueprint(bp as any)).toContain("retryFromNodeId");
    });

    it("accepts valid blueprint", () => {
      const bp = {
        id: "test", name: "Test", description: "T", trigger: { keywords: ["t"] },
        nodes: [
          { id: "do", name: "Do", type: "agentic" },
          { id: "check", name: "Check", type: "deterministic", gate: { checks: [{ type: "test", language: "typescript" }], onFail: "retry" } },
          { id: "fix", name: "Fix", type: "agentic", maxIterations: 2, retryFromNodeId: "check" },
        ],
      };
      expect(validateBlueprint(bp as any)).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/server && bun run test -- tests/cycle-loader.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the loader**

Create `packages/server/src/cycles/loader.ts`:
- `loadCustomCycles(workspacePath)` — scans `<workspacePath>/.patchwork/cycles/*.json`, parses, validates, returns valid Blueprint array
- `validateBlueprint(bp)` — returns null if valid, error string if invalid. Checks: required fields, duplicate node IDs, maxIterations 1-5, retryFromNodeId references valid node, no collision with hardcoded IDs
- Logs warnings for skipped configs (console.warn)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/server && bun run test -- tests/cycle-loader.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/cycles/loader.ts packages/server/tests/cycle-loader.test.ts
git commit -m "feat: add custom cycle config loader with validation"
```

---

### Task 17: Issue Dispatch Cycle Detection

**Files:**
- Modify: `packages/server/src/orchestrator/dispatcher.ts`

- [ ] **Step 1: Read dispatcher.ts to understand current dispatch flow**

Reference: `packages/server/src/orchestrator/dispatcher.ts`

- [ ] **Step 2: Add cycle detection to issue dispatch**

After the thread is created and before the first turn is sent, add cycle detection:

1. Check issue labels against blueprint trigger configs:
   - `bug` label → `debug` cycle
   - `feature` label → `feature-dev` cycle
   - `review` label → `code-review` cycle
   - Custom labels checked against custom cycle triggers

2. If no label match, fall back to keyword matching on issue title/body against blueprint `trigger.keywords`

3. If a cycle is detected, include `blueprintId` in the thread's initial turn metadata so the agent starts the cycle automatically

4. Default to no cycle if nothing matches (agent can still start one manually)

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/orchestrator/dispatcher.ts
git commit -m "feat: detect cycle from issue labels and keywords during dispatch"
```

---

### Task 18: Integration Test

- [ ] **Step 1: Run all server tests**

Run: `cd packages/server && bun run test`
Expected: All new tests pass (gate-plugins, gate-runner, cycle-engine, cycle-blueprints, cycle-api, cycle-loader). Pre-existing failures in unrelated tests are acceptable.

- [ ] **Step 2: Run UI TypeScript check**

Run: `cd packages/ui && bun tsc --noEmit 2>&1 | grep -v "@patchwork/shared"`
Expected: No errors in our new/modified files

- [ ] **Step 3: Verify server TypeScript check**

Run: `cd packages/server && bun tsc --noEmit 2>&1 | grep -v "@patchwork/shared"`
Expected: No errors in our new/modified files

- [ ] **Step 4: Commit any remaining fixes**

```bash
git commit -m "fix: resolve integration issues from blueprint cycles"
```
