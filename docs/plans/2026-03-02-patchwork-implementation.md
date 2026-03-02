# Patchwork Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an autonomous multi-agent coding platform that orchestrates Claude Code (PTY) and Codex (SDK) inside isolated Docker containers, producing PR-ready branches via a Stripe Minions-style blueprint engine powered by DBOS durable workflows.

**Architecture:** Event-sourced monolith. DBOS + PostgreSQL for durable state. Express API + WebSocket streaming. Docker containers with a Node.js sidecar for isolation. Next.js responsive web UI.

**Tech Stack:** TypeScript, DBOS Transact SDK, PostgreSQL, Express, dockerode, node-pty, @openai/codex-sdk, Next.js 15, Tailwind + shadcn/ui, Monaco Editor

**Design doc:** `docs/plans/2026-03-02-patchwork-design.md`

---

## Phase 1: Foundation

### Task 1: Monorepo Scaffold

**Files:**
- Create: `package.json` (root workspace)
- Create: `tsconfig.base.json`
- Create: `packages/sidecar/package.json`
- Create: `packages/sidecar/tsconfig.json`
- Create: `packages/server/package.json`
- Create: `packages/server/tsconfig.json`
- Create: `packages/ui/package.json` (placeholder)
- Create: `docker-compose.yml`

**Step 1: Create root workspace package.json**

```json
{
  "name": "patchwork",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "npm run build --workspaces",
    "test": "npm run test --workspaces",
    "dev:server": "npm run dev -w packages/server",
    "dev:sidecar": "npm run dev -w packages/sidecar",
    "dev:ui": "npm run dev -w packages/ui"
  }
}
```

**Step 2: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist"
  }
}
```

**Step 3: Create packages/sidecar/package.json**

```json
{
  "name": "@patchwork/sidecar",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "express": "^5.0.0",
    "node-pty": "^1.0.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/ws": "^8.5.0",
    "supertest": "^7.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

**Step 4: Create packages/server/package.json**

```json
{
  "name": "@patchwork/server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:migrate": "tsx src/db/migrate.ts"
  },
  "dependencies": {
    "@dbos-inc/dbos-sdk": "^2.13.0",
    "dockerode": "^4.0.0",
    "express": "^5.0.0",
    "pg": "^8.13.0",
    "ws": "^8.18.0",
    "uuid": "^11.0.0"
  },
  "devDependencies": {
    "@types/dockerode": "^3.3.0",
    "@types/express": "^5.0.0",
    "@types/pg": "^8.11.0",
    "@types/uuid": "^10.0.0",
    "@types/ws": "^8.5.0",
    "tsx": "^4.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

**Step 5: Create docker-compose.yml**

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: patchwork
      POSTGRES_PASSWORD: patchwork
      POSTGRES_DB: patchwork
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  server:
    build:
      context: .
      dockerfile: packages/server/Dockerfile
    depends_on:
      - postgres
    ports:
      - "3001:3001"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - patchwork-data:/data/patchwork
    environment:
      DBOS_SYSTEM_DATABASE_URL: postgresql://patchwork:patchwork@postgres:5432/patchwork
      FILE_STORE_PATH: /data/patchwork

volumes:
  pgdata:
  patchwork-data:
```

**Step 6: Install dependencies and verify**

Run: `npm install`
Run: `cd packages/sidecar && npx tsc --noEmit` — Expected: no errors
Run: `cd packages/server && npx tsc --noEmit` — Expected: no errors

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: scaffold patchwork monorepo with sidecar, server, and ui packages"
```

---

### Task 2: Sidecar — Health + Exec Endpoints

The sidecar runs inside devbox containers and runs commands on behalf of the server.

**Files:**
- Create: `packages/sidecar/src/index.ts`
- Create: `packages/sidecar/src/routes/health.ts`
- Create: `packages/sidecar/src/routes/exec.ts`
- Test: `packages/sidecar/tests/health.test.ts`
- Test: `packages/sidecar/tests/exec.test.ts`

**Step 1: Write failing test for health endpoint**

```typescript
// packages/sidecar/tests/health.test.ts
import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/index.js";

describe("GET /health", () => {
  it("returns status ok with uptime", async () => {
    const app = createApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body).toHaveProperty("uptime");
  });
});
```

**Step 2: Run test — verify it fails**

Run: `cd packages/sidecar && npx vitest run tests/health.test.ts`
Expected: FAIL — createApp not found

**Step 3: Implement app factory + health route**

Create `packages/sidecar/src/index.ts` with Express app factory.
Create `packages/sidecar/src/routes/health.ts` returning `{ status: "ok", uptime }`.

**Step 4: Run test — verify it passes**

Run: `cd packages/sidecar && npx vitest run tests/health.test.ts`
Expected: PASS

**Step 5: Write failing test for exec endpoint**

Test POST /exec with: simple echo command, non-zero exit, timeout, missing cmd (400).
Use supertest against the Express app.

**Step 6: Implement exec route**

Uses `execFile` from `node:child_process` (NOT `exec` — avoids shell injection).
Accepts `{ cmd, args, cwd, timeout }`. Returns `{ exitCode, stdout, stderr }`.
Default cwd: `/workspace`. Default timeout: 30s.

**Step 7: Run all sidecar tests — verify pass**

Run: `cd packages/sidecar && npx vitest run`
Expected: all PASS

**Step 8: Commit**

```bash
git add packages/sidecar/
git commit -m "feat(sidecar): add health and exec endpoints"
```

---

### Task 3: Sidecar — Git Service

**Files:**
- Create: `packages/sidecar/src/routes/git.ts`
- Test: `packages/sidecar/tests/git.test.ts`

**Step 1: Write failing tests for git routes**

Create a temp git repo in beforeAll. Test:
- GET /git/status — clean repo returns empty files array
- GET /git/status — modified file appears in files
- GET /git/diff — returns unified diff
- POST /git/commit — creates commit, returns SHA
- POST /git/apply — applies a patch

**Step 2: Implement git routes**

All git operations use `execFile("git", [...args])` — never shell exec.

Routes:
- GET /git/status — parses `git status --porcelain=v2`
- GET /git/diff — runs `git diff`, returns unified diff string
- POST /git/apply — runs `git apply --3way` with patch as stdin
- POST /git/commit — runs `git add` then `git commit`, returns SHA
- POST /git/push — runs `git push`

**Step 3: Wire into app, run tests, commit**

```bash
git add packages/sidecar/
git commit -m "feat(sidecar): add git status, diff, apply, commit, push endpoints"
```

---

### Task 4: Sidecar — File System Service

**Files:**
- Create: `packages/sidecar/src/routes/fs.ts`
- Test: `packages/sidecar/tests/fs.test.ts`

**Step 1: Write failing tests**

Test GET /fs/read (read file, 404 on missing), POST /fs/write (write file, read back).

**Step 2: Implement fs routes**

Uses `node:fs/promises` readFile/writeFile. Validates path and content params.

**Step 3: Wire into app, run tests, commit**

```bash
git add packages/sidecar/
git commit -m "feat(sidecar): add filesystem read/write endpoints"
```

---

### Task 5: Sidecar — PTY Manager

This is the critical component for Claude Code integration.

**Files:**
- Create: `packages/sidecar/src/pty-manager.ts`
- Create: `packages/sidecar/src/routes/pty.ts`
- Test: `packages/sidecar/tests/pty.test.ts`

**Step 1: Write failing test for PTY lifecycle**

Test PtyManager class:
- start() spawns a process and captures output
- write() sends data to stdin
- kill() terminates the process
- waitForExit() resolves with exit code

**Step 2: Implement PtyManager**

Uses `node-pty` to spawn processes in a pseudo-terminal.
- PtySession class wraps an IPty process
- Emits "data" events for output, "exit" for termination
- Tracks exitCode
- PtyManager creates/tracks/destroys sessions by ID

**Step 3: Run PTY tests**

Run: `cd packages/sidecar && npx vitest run tests/pty.test.ts`
Expected: PASS

**Step 4: Add HTTP routes for PTY management**

POST /pty/start — creates session, returns sessionId
POST /pty/write — sends data to session stdin
POST /pty/resize — resizes terminal
POST /pty/kill — kills session

**Step 5: Add WebSocket endpoint for PTY streaming**

GET /pty/stream?id=<sessionId> — WebSocket that streams PTY output as JSON messages:
`{ type: "data", data: "...", timestamp: 123 }`
`{ type: "exit", exitCode: 0 }`

**Step 6: Run all sidecar tests, commit**

```bash
git add packages/sidecar/
git commit -m "feat(sidecar): add PTY manager with WebSocket streaming"
```

---

### Task 6: Server — DBOS + PostgreSQL Skeleton

**Files:**
- Create: `packages/server/src/index.ts`
- Create: `packages/server/src/db/schema.sql`
- Create: `packages/server/src/db/migrate.ts`
- Test: `packages/server/tests/setup.test.ts`

**Step 1: Write docker-compose up for postgres**

Run: `docker compose up -d postgres`

**Step 2: Write failing test for DBOS launch**

Test that DBOS.setConfig + DBOS.launch succeeds against local Postgres.

**Step 3: Create server entry point**

`packages/server/src/index.ts` — Express app + DBOS init + health endpoint at GET /api/health.

**Step 4: Create schema.sql**

Full PostgreSQL schema from design doc Section 8:
- devbox_templates, runs, devboxes, run_steps, patches, transcript_events, artifacts
- All indexes

**Step 5: Create migration runner**

`packages/server/src/db/migrate.ts` — reads schema.sql, runs against Postgres via pg client.

**Step 6: Run migration**

Run: `cd packages/server && npx tsx src/db/migrate.ts`
Expected: "Migration complete"

**Step 7: Run setup test, commit**

```bash
git add packages/server/
git commit -m "feat(server): add DBOS + PostgreSQL skeleton with schema migration"
```

---

### Task 7: Server — Devbox Template CRUD

**Files:**
- Create: `packages/server/src/db/queries.ts`
- Create: `packages/server/src/api/templates.ts`
- Test: `packages/server/tests/templates.test.ts`

**Step 1: Write failing tests for CRUD**

Test POST /api/templates, GET /api/templates, GET /api/templates/:id, PUT /api/templates/:id, DELETE /api/templates/:id.

**Step 2: Implement queries.ts**

Raw pg queries for devbox_templates table: insert, findAll, findById, update, remove.

**Step 3: Implement templates router**

Express router with validation (name, baseImage, resourceLimits required).

**Step 4: Wire into server, run tests, commit**

```bash
git add packages/server/
git commit -m "feat(server): add devbox template CRUD API"
```

---

### Task 8: Server — Docker Container Management

**Files:**
- Create: `packages/server/src/devbox/manager.ts`
- Create: `packages/server/src/devbox/types.ts`
- Test: `packages/server/tests/devbox-manager.test.ts`

**Step 1: Write failing test for container lifecycle**

Test DevboxManager: create (returns containerId + status), destroy (stops + removes),
run a command inside via exec.

**Step 2: Implement DevboxManager using dockerode**

- create(): docker.createContainer + container.start, returns containerId + host IP
- destroy(): container.stop + container.remove (force)
- exec(): container.exec with command, capture stdout/stderr
- list(): docker.listContainers filtered by patchwork label

Container config includes: resource limits (memory, cpus), network mode, labels, env vars.

**Step 3: Add devboxes API routes**

GET /api/devboxes, POST /api/devboxes, DELETE /api/devboxes/:id, GET /api/devboxes/:id/status.

**Step 4: Run tests (requires Docker daemon), commit**

```bash
git add packages/server/
git commit -m "feat(server): add Docker container management via dockerode"
```

---

## Phase 2: Single Agent

### Task 9: Shared Types Package

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/types.ts`

Define all shared TypeScript interfaces from design doc:
- AgentBackend, AgentConfig, AgentEvent, AgentSession
- PatchArtifact, PatchMetadata
- BlueprintDefinition, BlueprintNode, BlueprintEdge
- DevboxTemplate, DevboxStatus
- RunStatus, RunResult, TaskSpec

**Commit:**
```bash
git commit -m "feat(shared): add shared type definitions for server, sidecar, and UI"
```

---

### Task 10: Agent Backend — Common Interface + Agent Loop

**Files:**
- Create: `packages/server/src/agents/backend.ts` (interface)
- Create: `packages/server/src/agents/loop.ts` (agent loop function)
- Test: `packages/server/tests/agent-loop.test.ts`

**Step 1: Write failing test with mock backend**

Create MockAgentBackend that emits a sequence of events: tool_call, tool_result, message, done_marker.

Test that agentLoop():
- Forwards allowed tool calls to sidecar (mock sidecar client)
- Rejects tool calls not in allowedTools
- Stops on done_marker and calls collectPatches
- Stops on budget_exceeded
- Records all events via recordTranscriptEvent

**Step 2: Implement agentLoop() function**

The core function from design doc Section 4: iterates over session.events(), switches on event type, forwards tools to sidecar, enforces allowlist, collects patches on completion.

**Step 3: Run tests, commit**

```bash
git commit -m "feat(server): add agent loop with tool gating and budget enforcement"
```

---

### Task 11: Claude Code PTY Backend

**Files:**
- Create: `packages/server/src/agents/claude.ts`
- Test: `packages/server/tests/claude-backend.test.ts`

**Step 1: Write failing test**

Test ClaudeBackend:
- Calls sidecar POST /pty/start with "claude" command
- Sends task prompt via POST /pty/write (with Patchwork constraints)
- Streams PTY output via WebSocket
- Detects PATCHWORK_DONE marker in output
- Falls back to checking for patch file existence via sidecar GET /fs/read
- Handles timeout (budget enforcement)

**Step 2: Implement ClaudeBackend**

ClaudeBackend implements AgentBackend interface.
- startSession: calls sidecar /pty/start, connects WebSocket to /pty/stream
- sendTask: formats prompt with Patchwork constraints, sends via /pty/write
- events: async generator that yields AgentEvents parsed from PTY output stream
  - raw_pty events for all output
  - done_marker when PATCHWORK_DONE detected or patch file found
  - budget_exceeded when timeout hit
- terminate: calls /pty/kill

Completion detection layers:
1. Patch file at /workspace/patches/ (poll sidecar /fs/read periodically)
2. PATCHWORK_DONE marker in PTY output
3. PTY process exit
4. Timeout

**Step 3: Run tests, commit**

```bash
git commit -m "feat(server): add Claude Code PTY backend with completion detection"
```

---

### Task 12: Codex SDK Backend

**Files:**
- Create: `packages/server/src/agents/codex.ts`
- Test: `packages/server/tests/codex-backend.test.ts`

**Step 1: Write failing test**

Test CodexBackend:
- Creates a Codex thread via SDK
- Sends task prompt
- Streams events from runStreamed()
- Maps Codex events to AgentEvents
- Forwards tool calls to sidecar
- Handles turn.completed

**Step 2: Implement CodexBackend**

CodexBackend implements AgentBackend interface.
- Uses `@openai/codex-sdk` — `new Codex({ workingDirectory })` + `startThread()` + `runStreamed()`
- Maps Codex SDK events to unified AgentEvent types
- Tool calls forwarded to sidecar via HTTP

Note: The exact Codex SDK event schema needs to be discovered from the SDK source/docs.
The implementation maps whatever Codex emits to our AgentEvent discriminated union.

**Step 3: Run tests, commit**

```bash
git commit -m "feat(server): add Codex SDK backend"
```

---

### Task 13: Patch Collection + Storage

**Files:**
- Create: `packages/server/src/patchwork/collector.ts`
- Create: `packages/server/src/patchwork/store.ts`
- Test: `packages/server/tests/patchwork-collector.test.ts`

**Step 1: Write failing test**

Test collectPatches():
- Given a devbox with modified files, collects git diff as a patch
- Checks /workspace/patches/ for explicit files first
- Falls back to git diff from sidecar
- Normalizes patch content
- Stores in file store at /data/patchwork/patches/{runId}/
- Inserts row in patches table

**Step 2: Implement collector.ts**

- collectPatches(devboxId, runId, stepId): calls sidecar git/diff, checks fs for explicit patches, normalizes, returns PatchArtifact[]
- storePatch(patch): writes to file store + inserts DB row

**Step 3: Run tests, commit**

```bash
git commit -m "feat(server): add patch collection and storage"
```

---

### Task 14: Patch Merger

**Files:**
- Create: `packages/server/src/patchwork/merger.ts`
- Test: `packages/server/tests/patchwork-merger.test.ts`

**Step 1: Write failing tests**

Test PatchworkMerger.mergeAndCommit():
- Sequential apply: two patches touching different files, both apply cleanly
- Three-way merge: overlapping patches, auto-resolved
- Conflict detection: irreconcilable patches, returns error
- Creates a single commit with all patches applied

**Step 2: Implement merger.ts**

- mergeAndCommit(devboxId, runId): loads all patches for run, applies in order via sidecar /git/apply, commits via /git/commit
- Escalating strategy: try sequential, fall back to --3way, report conflicts

**Step 3: Run tests, commit**

```bash
git commit -m "feat(server): add patch merger with escalating strategies"
```

---

### Task 15: Simple Blueprint (3-step DBOS Workflow)

**Files:**
- Create: `packages/server/src/blueprints/simple.ts`
- Test: `packages/server/tests/blueprint-simple.test.ts`

**Step 1: Write failing test**

Test that simple blueprint workflow:
1. Provisions devbox (mock)
2. Runs agent loop (mock)
3. Collects patches
4. Merges + commits
5. Records steps in run_steps table
6. Updates run status through lifecycle

**Step 2: Implement as DBOS registered workflow**

```typescript
async function simpleBlueprint(runId: string, task: TaskSpec) {
  const devbox = await DBOS.runStep(
    () => DevboxManager.provision(task.templateId, task.repo),
    { name: "provision" }
  );
  await DBOS.runStep(
    () => AgentManager.runAgentLoop({ devboxId: devbox.id, ...task }),
    { name: "implement" }
  );
  const sha = await DBOS.runStep(
    () => PatchworkMerger.mergeAndCommit(devbox.id, runId),
    { name: "commit" }
  );
  await DBOS.runStep(
    () => DevboxManager.destroy(devbox.id),
    { name: "cleanup" }
  );
  return { runId, sha, status: "completed" };
}
export const simpleBlueprintWorkflow = DBOS.registerWorkflow(simpleBlueprint);
```

**Step 3: Run tests, commit**

```bash
git commit -m "feat(server): add simple 3-step blueprint as DBOS workflow"
```

---

### Task 16: Runs API + WebSocket Streaming

**Files:**
- Create: `packages/server/src/api/runs.ts`
- Create: `packages/server/src/api/ws.ts`
- Test: `packages/server/tests/runs-api.test.ts`

**Step 1: Implement runs CRUD**

- POST /api/runs — create run record, start blueprint workflow
- GET /api/runs — list runs with status/repo/creator filters
- GET /api/runs/:id — run detail with steps, patches, transcript
- POST /api/runs/:id/cancel — cancel run
- GET /api/runs/:id/patches — list patches
- GET /api/runs/:id/diff — combined diff
- GET /api/runs/:id/transcript — paginated transcript events

**Step 2: Implement WebSocket streaming**

WS /api/runs/:id/stream — when client connects:
- Send existing transcript events as initial payload
- Subscribe to new events (poll or notify) and push to client
- Push blueprint state transitions
- Push PTY output chunks for live viewing

**Step 3: Run tests, commit**

```bash
git commit -m "feat(server): add runs API and WebSocket event streaming"
```

---

## Phase 3: Full Pipeline

### Task 17: Full Minion Blueprint

Implement the complete blueprint from design doc Section 6. Each node is a DBOS step.

**Files:**
- Create: `packages/server/src/blueprints/minion.ts`
- Create: `packages/server/src/blueprints/context.ts` (context engineering per node)
- Test: `packages/server/tests/blueprint-minion.test.ts`

Key features:
- Lint loop: for loop with max 3 iterations, deterministic lint + agent fix
- Review node: agent with read-only tool allowlist
- CI integration: push, poll, auto-apply fixes, agent fix loop (max 1)
- Context engineering helpers: buildImplementerContext, buildReviewerContext, buildCIFixerContext

```bash
git commit -m "feat(server): add full minion blueprint with lint loop and CI retry"
```

---

### Task 18: Blueprint Engine (JSON-driven)

Dynamic engine that interprets BlueprintDefinition JSON and executes as DBOS workflow.

**Files:**
- Create: `packages/server/src/blueprints/engine.ts`
- Create: `packages/server/src/blueprints/definitions.ts` (built-in blueprint JSONs)
- Test: `packages/server/tests/blueprint-engine.test.ts`

Supports: conditional edges (on_success/on_failure), loop edges with retry counters, agent vs deterministic nodes, placeholder expansion in prompt templates.

```bash
git commit -m "feat(server): add dynamic blueprint engine from JSON definitions"
```

---

### Task 19: CI Integration

**Files:**
- Create: `packages/server/src/ci/manager.ts`
- Test: `packages/server/tests/ci-manager.test.ts`

CIManager: push branch via sidecar /git/push, trigger CI (GitHub Actions webhook or poll), parse failure logs, extract failing tests, apply autofixes, return structured CIResult.

```bash
git commit -m "feat(server): add CI integration with push, poll, and failure parsing"
```

---

### Task 20: Agent Router

**Files:**
- Create: `packages/server/src/agents/router.ts`
- Test: `packages/server/tests/agent-router.test.ts`

Dynamic routing: role defaults, language detection, task type classification, user preference override, availability check.

```bash
git commit -m "feat(server): add dynamic agent routing"
```

---

## Phase 4: UI

### Task 21: Next.js App Scaffold

Run: `cd packages && npx create-next-app@latest ui --typescript --tailwind --app --src-dir`
Then: `cd ui && npx shadcn@latest init`

```bash
git commit -m "feat(ui): scaffold Next.js 15 app with Tailwind and shadcn/ui"
```

---

### Task 22: API Client + Types

**Files:**
- Create: `packages/ui/src/lib/api.ts`
- Create: `packages/ui/src/lib/types.ts`

Typed fetch wrapper for all server endpoints. Shared types imported from @patchwork/shared.

```bash
git commit -m "feat(ui): add typed API client"
```

---

### Task 23: Runs List Page

**Files:**
- Create: `packages/ui/src/app/runs/page.tsx`
- Create: `packages/ui/src/components/run-card.tsx`
- Create: `packages/ui/src/components/status-badge.tsx`

Card-based list: status badge, repo+branch, agent backend indicator, current blueprint node, last message preview, time since start, quick actions menu.

Mobile: stacked cards. Desktop: optional table layout.

```bash
git commit -m "feat(ui): add runs list page with status badges and filtering"
```

---

### Task 24: Run Detail — Transcript Feed

**Files:**
- Create: `packages/ui/src/app/runs/[id]/page.tsx`
- Create: `packages/ui/src/components/transcript-feed.tsx`
- Create: `packages/ui/src/components/transcript-event.tsx`
- Create: `packages/ui/src/hooks/use-run-stream.ts`

Left pane: scrolling event feed with agent messages, tool events (expandable), blueprint transitions. WebSocket hook for live updates.

```bash
git commit -m "feat(ui): add run detail page with live transcript feed"
```

---

### Task 25: Run Detail — Diff Viewer

**Files:**
- Create: `packages/ui/src/components/diff-viewer.tsx`
- Create: `packages/ui/src/components/file-list.tsx`

Right pane: file list with +/- counters. Click file shows Monaco diff. Tabs: Changed Files, Patches, CI, Meta.

```bash
git commit -m "feat(ui): add diff viewer with Monaco Editor and file list"
```

---

### Task 26: Blueprint DAG Widget

**Files:**
- Create: `packages/ui/src/components/blueprint-dag.tsx`

SVG-based DAG: rectangles for deterministic, rounded for agent. Green check/blue pulse/red X/gray outline. Loop edges as curved arrows. Click node jumps to transcript step.

```bash
git commit -m "feat(ui): add blueprint DAG visualizer widget"
```

---

### Task 27: New Run Form

**Files:**
- Create: `packages/ui/src/app/runs/new/page.tsx`
- Create: `packages/ui/src/components/run-form.tsx`

Fields: repo selector, branch input, template dropdown, blueprint dropdown, task textarea, agent preference (Auto/Claude/Codex/Both). Submit calls POST /api/runs.

```bash
git commit -m "feat(ui): add new run creation form"
```

---

### Task 28: WebSocket Live Updates

Wire use-run-stream.ts into all components. Transcript updates live. File list refreshes on patch creation. DAG updates on node transitions. Status badge updates on run status change.

```bash
git commit -m "feat(ui): wire WebSocket live updates across all run detail components"
```

---

### Task 29: Templates + Blueprints Pages

**Files:**
- Create: `packages/ui/src/app/templates/page.tsx`
- Create: `packages/ui/src/app/blueprints/page.tsx`
- Create: `packages/ui/src/app/blueprints/[id]/page.tsx`

Templates: CRUD list/form. Blueprints: gallery of built-in + custom, detail page with DAG visualizer.

```bash
git commit -m "feat(ui): add templates and blueprints management pages"
```

---

## Phase 5: Polish

### Task 30: Auth Proxy

**Files:**
- Create: `packages/server/src/auth/proxy.ts`
- Create: `packages/server/src/auth/crypto.ts` (AES-256-GCM)
- Create: `packages/server/src/api/auth.ts`
- Create: `packages/ui/src/app/settings/page.tsx`

OAuth flow for Claude Code and Codex. Encrypt tokens at rest. Inject into containers. Monitor expiry.

```bash
git commit -m "feat: add auth proxy with encrypted token storage and settings page"
```

---

### Task 31: Multi-Agent Patterns

**Files:**
- Create: `packages/server/src/blueprints/writer-reviewer.ts`
- Create: `packages/server/src/blueprints/spec-implement-review.ts`

Two additional built-in blueprints using multiple agent roles per run.

```bash
git commit -m "feat(server): add writer+reviewer and spec-implement-review blueprints"
```

---

### Task 32: Devbox Docker Images

**Files:**
- Create: `docker/Dockerfile.devbox-base` (sidecar + git + common tools)
- Create: `docker/Dockerfile.devbox-node` (+ Node.js)
- Create: `docker/Dockerfile.devbox-python` (+ Python)

```bash
git commit -m "feat(docker): add base devbox images with sidecar pre-installed"
```

---

### Task 33: Mobile Responsive Polish

Ensure all UI works on phone:
- Runs list: card layout
- Run detail: tabbed instead of split pane
- New run: full-width
- DAG: horizontal scroll or progress bar

```bash
git commit -m "feat(ui): polish mobile responsive layout"
```

---

## Summary

| Phase | Tasks | Delivers |
|-------|-------|---------|
| 1: Foundation | 1-8 | Monorepo, sidecar (exec/git/fs/pty), server (DBOS+Postgres), Docker mgmt, template CRUD |
| 2: Single Agent | 9-16 | Agent backends (Claude PTY + Codex SDK), agent loop, patches, simple blueprint, runs API |
| 3: Full Pipeline | 17-20 | Minion blueprint, JSON blueprint engine, CI integration, agent routing |
| 4: UI | 21-29 | Runs list, run detail (transcript+diffs+DAG), new run, live updates, management pages |
| 5: Polish | 30-33 | Auth proxy, multi-agent patterns, devbox images, mobile polish |

Total: 33 tasks across 5 phases. Each task follows TDD: write test, verify fail, implement, verify pass, commit.
