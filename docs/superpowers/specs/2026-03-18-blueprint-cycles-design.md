# Blueprint Development Cycles

**Date:** 2026-03-18
**Status:** Draft
**Scope:** Structured development cycles (blueprints) that enforce quality gates for AI coding agents, inspired by Stripe's minion blueprint pattern.

---

## Problem Statement

AI coding agents take shortcuts: skipping type checks, writing `as any` bypasses, producing code without tests, committing without verification. There is no structured process that guarantees quality — the agent's system prompt is advisory, not enforced.

Additionally, different tasks (feature development, debugging, code review, production verification) require different workflows, but agents treat every task the same way: read code, make changes, commit. There's no phase discipline, no quality gates between phases, and no visibility into where in the process the agent currently is.

### Goals

1. **Deterministic quality enforcement** — Agents cannot skip type checks, linting, or tests. These run as platform code, not LLM decisions.
2. **Structured phases** — Each task type follows a defined workflow with clear phase boundaries.
3. **Visibility** — Users see exactly which phase the agent is in, which gates passed/failed, and overall cycle progress.
4. **Extensibility** — Core cycles are hardcoded; power users can define custom cycles via config files.
5. **Language-pluggable** — Quality gates work for TypeScript now, with a clean interface for adding Go, Rust, Python, etc. with minimal effort.

---

## Architecture: Blueprint Engine

A **blueprint** is a state machine with two node types:

- **Agentic nodes** — The LLM does creative work (spec writing, implementation, review). The agent has latitude to make decisions.
- **Deterministic nodes** — The platform runs code with no LLM involvement (typecheck, lint, test, build). Results are pass/fail.

Nodes can have **gates** — conditions that must pass before the engine advances. Gates are the enforcement mechanism that prevents agents from skipping quality steps.

The engine walks the state machine sequentially. Agentic nodes complete when the agent calls `cycle_advance`. Deterministic nodes complete when the platform finishes running checks. Failed gates can retry (via a fix loop), block (pause for human), or report (log and continue).

This is directly inspired by Stripe's minion blueprints: "putting LLMs into contained boxes" where creative phases are flexible and verification phases are deterministic.

---

## Core Data Model

### Blueprint Definition

```typescript
interface Blueprint {
  id: string;                    // e.g. "feature-dev", "debug", "code-review"
  name: string;                  // e.g. "Feature Development"
  description: string;
  trigger: TriggerConfig;        // how this cycle gets detected/activated
  nodes: BlueprintNode[];        // ordered sequence
}

interface TriggerConfig {
  keywords: string[];            // prompt keywords that suggest this cycle
  issueLabels?: string[];        // board issue labels that map to this cycle
}

interface BlueprintNode {
  id: string;                    // e.g. "spec", "plan", "implement"
  name: string;                  // e.g. "Write Specification"
  type: "agentic" | "deterministic";
  prompt?: string;               // system prompt fragment for agentic nodes
  tools?: string[];              // restrict available tools for this phase
  gate?: Gate;                   // must pass before advancing
  maxIterations?: number;        // max fix-loop cycles (default 1, e.g. 2 for fix-ci). One "cycle" = Fix → re-run all gates.
  retryFromNodeId?: string;      // on fix loop, jump back to this node instead of re-running current. Required when maxIterations > 1.
  skipCondition?: string;        // predefined flag name to skip this node (see Skip Conditions below)
}

interface Gate {
  checks: GateCheck[];           // all must pass
  onFail: "retry" | "block" | "notify";
}

interface GateCheck {
  type: "typecheck" | "lint" | "test" | "build" | "custom";
  command?: string;              // for custom checks
  language: string;              // gate plugin to use (e.g. "typescript")
}
```

### Fix Loop Routing

When a gate fails with `onFail: "retry"`, the engine needs to know how to loop. The mechanism:

1. The gate-bearing deterministic node (e.g., "Run Tests") fails
2. The engine advances to the next node, which must be the Fix node (type: `agentic`, `maxIterations > 0`)
3. After the Fix node completes (`cycle_advance`), the engine jumps back to the node specified by `retryFromNodeId` (e.g., "typecheck") and re-runs from there through the gate node
4. If the gate passes, the engine skips the Fix node and advances past it
5. If the gate fails again and iterations < maxIterations, repeat from step 2
6. If iterations >= maxIterations, the cycle halts with `status: "gate_failed"`

The `retryFromNodeId` field on Fix nodes makes the loop explicit. In the hardcoded feature-dev cycle, the Fix node has `retryFromNodeId: "typecheck"`, so a test failure triggers: Fix → Typecheck → Lint → Run Tests → (pass or retry).

`maxIterations` counts full loop cycles (Fix → gate re-run), not individual node executions. So `maxIterations: 2` means 2 fix attempts. Including the initial failure, the gate runs at most 3 times total.

### Skip Conditions

`skipCondition` references a predefined boolean flag name, not an arbitrary expression. The engine evaluates flags from the cycle's runtime context:

| Flag | True When |
|------|-----------|
| `isSmallTask` | Issue has "small" or "trivial" label, OR prompt is under 200 characters with no spec-like requirements |
| `isAutonomous` | Thread is autonomous (board issue dispatch, full-access mode) |
| `hasExistingTests` | Workspace has test files matching the affected source files |
| `hasPrDiff` | Thread has a PR diff available for review |

Custom cycles can only reference these predefined flags. No arbitrary expression evaluation — this keeps the system simple and secure.

### Relationship to Existing Run/RunStep Models

The database already has `Run` and `RunStep` models (in `prisma/schema.prisma`) from an earlier pipeline system. These are **separate concepts**:

- `Run` is a standalone pipeline execution tied to a repo/branch/devbox — it predates the thread-based session model and is used by the legacy blueprint engine in `packages/server/src/blueprints/`.
- `CycleRun` is a thread-scoped development cycle integrated with the agent session, MCP tools, and real-time event streaming.

These two systems coexist. `CycleRun` does not replace `Run` — they serve different purposes. The legacy `Run` system may be deprecated in the future, but that is out of scope for this spec.

### Cycle Run (Persisted State)

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

Key constraints:
- `gateResults` is JSON — gate check results vary by check type and language. Avoids a third table.
- `onDelete: Cascade` — cycle runs deleted when thread is deleted.
- One active CycleRun per thread — starting a new cycle while one is running fails.
- `blueprintId` is a string, not a FK — blueprints are defined in code/config, not in the database.

---

## Language Gate Plugin Interface

Gates run language-specific checks without hardcoding any particular language.

### Plugin Interface

```typescript
interface LanguageGatePlugin {
  language: string;              // "typescript", "go", "rust", etc.
  detect(workspacePath: string): Promise<boolean>;
  checks: {
    typecheck?: GateCommand;
    lint?: GateCommand;
    test?: GateCommand;
    build?: GateCommand;
  };
}

interface GateCommand {
  command: string;               // e.g. "npx tsc --noEmit"
  args?: string[];
  parseOutput(stdout: string, stderr: string, exitCode: number): GateCheckResult;
}

interface GateCheckResult {
  passed: boolean;
  summary: string;               // e.g. "3 type errors", "all 47 tests passed"
  details?: string;              // full output for display
  errorCount?: number;
  warningCount?: number;
}
```

### TypeScript Plugin (Ships First)

```typescript
const typescriptGate: LanguageGatePlugin = {
  language: "typescript",
  detect: async (path) => /* check for tsconfig.json */,
  checks: {
    typecheck: {
      command: "npx tsc --noEmit",
      parseOutput: (stdout, stderr, code) => ({
        passed: code === 0,
        summary: code === 0 ? "No type errors" : `${countErrors(stderr)} type errors`,
        details: stderr,
        errorCount: countErrors(stderr),
      }),
    },
    lint: {
      command: "npx eslint . --max-warnings=0",
      parseOutput: /* similar */,
    },
    test: {
      command: "npx vitest run",
      parseOutput: /* similar */,
    },
    build: {
      command: "npx tsc",
      parseOutput: /* similar */,
    },
  },
};
```

### Strict Config Enforcement

The TypeScript plugin checks `tsconfig.json` for:
- `"strict": true` (required — warns if missing)
- `"noUncheckedIndexedAccess": true` (recommended)

And checks for ESLint rules:
- `@typescript-eslint/no-explicit-any` (required — prevents `any` bypass)
- `@typescript-eslint/no-unsafe-assignment` (recommended)

The agent's system prompt includes instructions to never add `@ts-ignore`, `as any`, or other type bypasses.

### Adding a New Language

Adding Go:

```typescript
const goGate: LanguageGatePlugin = {
  language: "go",
  detect: async (path) => /* check for go.mod */,
  checks: {
    typecheck: { command: "go vet ./...", parseOutput: /* ... */ },
    lint: { command: "golangci-lint run", parseOutput: /* ... */ },
    test: { command: "go test ./...", parseOutput: /* ... */ },
    build: { command: "go build ./...", parseOutput: /* ... */ },
  },
};
```

One file, register in plugin array.

---

## The Four Hardcoded Cycles

### 1. Feature Development Cycle

| Node | Type | Gate | Notes |
|------|------|------|-------|
| **Spec** | agentic | none | Interactive (chat) or auto-generated (board). Uses AskUserQuestion for clarification. Writes spec to Anki. Skipped for small tasks. |
| **Plan** | agentic | none | Breaks spec into tasks. Writes plan to Anki. Skipped for small tasks. |
| **Write Tests** | agentic | none | TDD — write failing tests first. Agent must run tests and confirm they fail. |
| **Implement** | agentic | none | Write minimal code to pass tests. |
| **Typecheck** | deterministic | must pass | Runs language gate typecheck. |
| **Lint** | deterministic | must pass | Runs language gate lint. Auto-fixes applied. |
| **Run Tests** | deterministic | must pass, on fail → retry via Fix | Runs language gate test. |
| **Fix** | agentic | loops back to Typecheck (`retryFromNodeId: "typecheck"`), max 2 attempts | If still failing after 2 fix attempts, status = gate_failed, notify user. |
| **Review** | agentic | none | Self-review + optional subagent dispatch for code review. |
| **Commit/PR** | deterministic | none | Commits changes, creates PR for autonomous runs. |

### 2. Debug Cycle

| Node | Type | Gate | Notes |
|------|------|------|-------|
| **Reproduce** | agentic | none | Understand the bug, find reproduction steps. |
| **Isolate** | agentic | none | Narrow to root cause. |
| **Regression Test** | agentic | none | Write a test that captures the bug (must fail before fix). |
| **Fix** | agentic | none | Minimal fix for the root cause. |
| **Typecheck** | deterministic | must pass | |
| **Lint** | deterministic | must pass | |
| **Run Tests** | deterministic | must pass, on fail → Fix Loop | |
| **Fix Loop** | agentic | loops back to Typecheck (`retryFromNodeId: "typecheck"`), max 2 attempts | |
| **Review** | agentic | none | Verify fix is minimal, no regressions. |
| **Commit/PR** | deterministic | none | |

### 3. Code Review Cycle

| Node | Type | Gate | Notes |
|------|------|------|-------|
| **Analyze Diff** | agentic | none | Read the diff, understand intent. |
| **Typecheck** | deterministic | report (don't block) | Report issues, don't fail cycle. |
| **Lint** | deterministic | report | |
| **Run Tests** | deterministic | report | |
| **Pattern Review** | agentic | none | Anti-patterns, code smells, architecture. Uses Anki cards for conventions. |
| **Security Review** | agentic | none | OWASP top 10, injection, auth. Can dispatch security-auditor subagent. |
| **Report** | agentic | none | Structured review with severity ratings. |

Code review gates use `report` mode — they surface issues but don't block. The cycle always completes with a report.

### 4. Production Check Cycle

| Node | Type | Gate | Notes |
|------|------|------|-------|
| **Full Test Suite** | deterministic | must pass | Complete test suite, not just affected files. |
| **Typecheck** | deterministic | must pass | |
| **Lint** | deterministic | must pass | |
| **Build** | deterministic | must pass | Full production build. |
| **Smoke Test** | agentic | none | Agent verifies key flows — starts app, checks routes, critical paths. |
| **Report** | agentic | none | All results, performance notes, deploy readiness. |

---

## Cycle Triggering & Detection

### Three Trigger Sources

1. **Chat prompt** — Agent detects cycle from user message. The system prompt includes available cycles with trigger keywords. Agent calls `cycle_start` MCP tool.
2. **Board issue dispatch** — Orchestrator detects cycle from issue labels (`bug` → debug, `feature` → feature-dev, `review` → code-review). Falls back to keyword heuristics, then defaults to feature-dev.
3. **UI button** — Dropdown in thread header (future, lower priority).

### Spec Phase Modes

- **Interactive spec (manual threads / big features)**: Back-and-forth conversation. Agent uses AskUserQuestion for clarification, proposes approaches, gets approval.
- **Auto-spec (board issues / small tasks)**: Agent self-generates spec from issue context + codebase exploration, writes to Anki, proceeds without human gate.

### MCP Tools

```
cycle_start    { blueprintId: string }            → Creates CycleRun, injects phase prompt
cycle_status   {}                                 → Returns current phase, gate results
cycle_advance  {}                                 → Agent signals agentic phase completed
cycle_skip     { nodeId: string, reason: string } → Skip a phase (e.g. skip spec for small task)
```

### System Prompt Integration

Appended to agent system prompt:

```
# Development Cycles

You have access to structured development cycles that enforce quality gates.
When a task matches a cycle, announce it and activate it using the `cycle_start` tool.

Available cycles:
- **feature-dev**: New features, enhancements, refactors. Triggers on: "add", "build", "implement", "create", "refactor"
- **debug**: Bug fixes, error investigation. Triggers on: "fix", "debug", "broken", "error", "bug"
- **code-review**: Review existing code/PR. Triggers on: "review", "check", "audit"
- **production-check**: Pre-deploy verification. Triggers on: "ready to deploy", "production check", "verify build"

When activating a cycle, use `cycle_start` with the cycle ID.
For small/routine tasks, you may skip spec and plan phases.
```

---

## Engine Execution Flow

### Main Loop

```
1. CycleRun created (via cycle_start MCP tool or issue dispatch)
2. Engine sets currentNodeIndex = 0
3. For each node:
   a. If skipCondition evaluates true → mark skipped, advance
   b. If node.type === "deterministic":
      - Engine runs gate checks directly (no LLM)
      - Emits cycle events to WebSocket
      - If gate passes → advance
      - If gate fails and onFail === "retry" → advance to Fix node
      - If gate fails and onFail === "block" → pause, notify user
      - If gate fails and onFail === "notify" → record result, advance (report mode)
   c. If node.type === "agentic":
      - Engine injects phase-specific prompt into agent context
      - Agent does work, calls cycle_advance when done
      - If node has gate → engine runs it after cycle_advance
4. When last node completes → CycleRun.status = "completed"
```

### Fix Loop

When `Run Tests` fails (Fix node has `maxIterations: 2`, `retryFromNodeId: "typecheck"`):

```
Run Tests (deterministic, fails) — initial failure
  → Fix attempt 1: Fix (agentic) → jump to Typecheck → Lint → Run Tests
  → Fix attempt 2: Fix (agentic) → jump to Typecheck → Lint → Run Tests
  → STOP. status = "gate_failed", notify user
```

`maxIterations: 2` means 2 fix attempts. The gate runs at most 3 times total (initial + 2 retries). Prevents infinite retry — same principle as Stripe's "at most two CI rounds."

### Phase Prompt Injection

When entering an agentic node, the engine appends a phase-specific prompt:

```
# Current Cycle: Feature Development
## Phase: Write Tests (3/10)

You are in the TDD test-writing phase. Your job:
- Write failing tests that capture the expected behavior from the spec
- Run the tests to confirm they FAIL (red phase)
- Do NOT write implementation code yet
- When tests are written and confirmed failing, call cycle_advance

Spec context: [from Anki or earlier conversation]
Plan context: [task breakdown from plan phase]
```

This prompt is replaced (not accumulated) when the phase changes, keeping context focused.

### Event Stream

```typescript
type CycleEvent =
  | { type: "cycle_started"; blueprintId: string; runId: string }
  | { type: "phase_started"; nodeId: string; nodeName: string; nodeType: string }
  | { type: "phase_completed"; nodeId: string; status: string }
  | { type: "gate_running"; checkType: string }
  | { type: "gate_result"; checkType: string; passed: boolean; summary: string; details?: string }
  | { type: "cycle_completed"; runId: string; status: string }
  | { type: "cycle_failed"; runId: string; nodeId: string; reason: string };
```

Flows through existing `ProviderEventEnvelope` → Queue → WebSocket pipeline.

---

## UI: Cycle Visualization

### Cycle Status Bar

Persistent bar at top of thread view, only visible when a cycle is active:

```
┌─────────────────────────────────────────────────────────────────┐
│ ● Feature Development    Implement (4/10)    ██████░░░░  60%   │
│   Spec ✓  Plan ✓  Tests ✓  Implement ●  Typecheck ○  Lint ○   │
└─────────────────────────────────────────────────────────────────┘
```

- Dot colors: green (passed), blue pulse (running), gray (pending), red (failed)
- Progress bar from `currentNodeIndex / totalNodes`
- Clicking a completed phase scrolls to its timeline entry
- Completed: bar turns green with duration
- Failed: bar turns red with failed gate info

### Timeline Integration

Phase transitions as dividers (like `context_compacted` style):

```
─── Phase: Write Tests (3/10) ──────────────────────
```

Gate results as expandable cards:

```
┌─ Typecheck ──────────────────────────────┐
│ ✓ Passed — No type errors                │
└──────────────────────────────────────────┘

┌─ Run Tests ──────────────────────────────┐
│ ✗ Failed — 3 of 47 tests failed          │
│   ▸ src/api/anki.test.ts:45 — expected…  │
│   Entering Fix phase (attempt 1/2)        │
└──────────────────────────────────────────┘
```

Cycle completion summary:

```
─── ✓ Feature Development completed (12m 34s) ─────
   Spec ✓  Plan ✓  Tests ✓  Implement ✓
   Typecheck ✓  Lint ✓  Tests ✓  Review ✓  Commit ✓
```

### New Timeline Item Kinds

- `phase_transition` — phase boundary divider
- `gate_result` — deterministic check result (expandable)
- `cycle_summary` — cycle completion/failure summary

No new pages or routes. Everything lives within the existing thread view.

---

## Custom Cycle Config Format

For power users defining cycles beyond the hardcoded four.

### Location

`<projectRoot>/.patchwork/cycles/<cycle-id>.json`

Engine loads hardcoded cycles first, then scans this directory. Custom cycles cannot override hardcoded IDs.

### Schema

```json
{
  "id": "migration",
  "name": "Database Migration",
  "description": "Safe database migration workflow",
  "trigger": {
    "keywords": ["migration", "migrate", "schema change"],
    "issueLabels": ["migration"]
  },
  "nodes": [
    {
      "id": "plan",
      "name": "Plan Migration",
      "type": "agentic",
      "prompt": "Analyze the requested schema change. Write a migration plan including rollback strategy."
    },
    {
      "id": "write-migration",
      "name": "Write Migration",
      "type": "agentic",
      "prompt": "Write the migration file following the project's conventions."
    },
    {
      "id": "typecheck",
      "name": "Type Check",
      "type": "deterministic",
      "gate": {
        "checks": [{ "type": "typecheck", "language": "typescript" }],
        "onFail": "retry"
      }
    },
    {
      "id": "test",
      "name": "Run Tests",
      "type": "deterministic",
      "gate": {
        "checks": [{ "type": "test", "language": "typescript" }],
        "onFail": "retry"
      }
    },
    {
      "id": "fix",
      "name": "Fix Issues",
      "type": "agentic",
      "prompt": "Fix the failing checks.",
      "maxIterations": 2,
      "retryFromNodeId": "typecheck"
    },
    {
      "id": "review",
      "name": "Review",
      "type": "agentic",
      "prompt": "Review the migration for safety."
    },
    {
      "id": "commit",
      "name": "Commit",
      "type": "deterministic"
    }
  ]
}
```

### Validation

At load time:
- Required: `id`, `name`, `nodes` (at least one)
- Each node: `id`, `name`, `type` required
- Deterministic nodes with gates must reference a registered language plugin
- `maxIterations` must be 1-5
- `retryFromNodeId` must reference a valid node ID that precedes the Fix node in the sequence
- When a gate has `onFail: "retry"`, the immediately following node must have `retryFromNodeId` set
- No duplicate node IDs
- `id` must not collide with hardcoded cycle IDs
- Invalid configs are logged and skipped

---

## Integration Points

### Server-Side Changes

| Existing File | Change |
|---|---|
| `providers/claude-code/adapter.ts` | Inject cycle phase prompt into system prompt. Check for active CycleRun on each turn. |
| `providers/claude-code/custom-tools.ts` | Add `cycle_start`, `cycle_status`, `cycle_advance`, `cycle_skip` MCP tools |
| `providers/claude-code/hooks.ts` | PreToolUse hook blocks `git commit` if cycle is active and gates haven't passed |
| `orchestrator/dispatcher.ts` | Detect cycle from issue labels/content, pass blueprintId to thread creation |
| `providers/service.ts` | On turn completion, check if engine needs to run deterministic nodes |
| `prisma/schema.prisma` | Add CycleRun, CycleNodeResult models + Thread relation |

### New Server Files

| File | Purpose |
|---|---|
| `cycles/engine.ts` | Core state machine execution |
| `cycles/blueprints.ts` | Hardcoded cycle definitions |
| `cycles/gates.ts` | Gate runner |
| `cycles/plugins/typescript.ts` | TypeScript language gate plugin |
| `cycles/plugins/index.ts` | Plugin registry |
| `cycles/loader.ts` | Custom cycle config loader |
| `cycles/events.ts` | Cycle event types |
| `api/cycles.ts` | REST endpoints for cycle status |

### UI Changes

| File | Change |
|---|---|
| `components/thread/timeline.tsx` | Add `phase_transition`, `gate_result`, `cycle_summary` kinds |
| `components/thread/cycle-status-bar.tsx` | **New** — phase progress bar |
| `components/thread/gate-result.tsx` | **New** — expandable gate result card |
| `app/projects/[projectId]/threads/[id]/page.tsx` | Mount CycleStatusBar, subscribe to cycle events |
| `lib/api.ts` | Add cycle status API methods |

### Event Flow

```
Engine runs gate → emits CycleEvent → ProviderEventEnvelope → Queue → WebSocket → UI
```

No new transport. Everything flows through the existing event infrastructure.

---

## Implementation Sub-Projects

Ordered by dependency. Each is independently shippable.

### Sub-Project 1: Quality Gates Foundation
Language gate plugin interface + TypeScript plugin + gate runner.
**Files:** `cycles/gates.ts`, `cycles/plugins/typescript.ts`, `cycles/plugins/index.ts`

### Sub-Project 2: Blueprint Engine Core
Engine state machine, CycleRun persistence, node execution loop, fix loop logic.
**Files:** `cycles/engine.ts`, `cycles/events.ts`, Prisma models, `api/cycles.ts`

### Sub-Project 3: Hardcoded Cycles + MCP Tools
Four cycle definitions, MCP tools, system prompt injection, commit-blocking hook.
**Files:** `cycles/blueprints.ts`, `custom-tools.ts` changes, `adapter.ts` changes, `hooks.ts` changes

### Sub-Project 4: UI — Cycle Visualization
CycleStatusBar, gate result items, phase transitions, cycle summary.
**Files:** `cycle-status-bar.tsx`, `gate-result.tsx`, `timeline.tsx` changes

### Sub-Project 5: Cycle Detection + Dispatch Integration
Issue label mapping, prompt detection, custom cycle config loader.
**Files:** `cycles/loader.ts`, `dispatcher.ts` changes

### Dependency Graph

```
SP1 (Gates) → SP2 (Engine) → SP3 (Cycles + MCP) → SP5 (Detection)
                                    ↓
                              SP4 (UI) — can parallel with SP3
```

---

## Testing Strategy

### Unit Tests
- Gate plugin: mock execFileSync, verify parseOutput for various compiler/linter outputs
- Engine: mock gates, test state machine transitions, fix loop termination, skip conditions
- Blueprints: verify all hardcoded cycles have valid structure
- Config loader: valid configs load, invalid configs are skipped

### Integration Tests
- Full cycle run: create thread, start cycle, walk through all phases, verify persistence
- Gate enforcement: agent attempts commit with failing typecheck, verify hook blocks it
- Fix loop: gate fails, engine retries via fix node, verify iteration count and max termination

### UI Tests
- CycleStatusBar renders correct phase states from mock events
- Gate result cards expand/collapse correctly
- Phase transitions render as dividers

---

## Out of Scope

- Visual cycle editor (UI for building custom cycles)
- Cross-thread cycle coordination (one cycle spanning multiple threads)
- Cycle analytics dashboard (success rates, average duration per phase)
- Non-TypeScript language gate plugins (interface ships, only TS implemented)
- Parallel node execution (all nodes are sequential in v1)
- Cycle templates marketplace
