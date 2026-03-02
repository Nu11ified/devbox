# Patchwork: Autonomous Multi-Agent Coding Platform

**Date:** 2026-03-02
**Status:** Design — pending implementation planning

---

## 1. Overview

Patchwork is an autonomous multi-agent coding platform inspired by Stripe's Minions system. It orchestrates Claude Code and OpenAI Codex to produce unattended, one-shot coding runs that end in PR-ready branches.

**Key constraints:**
- Claude Code is used via its terminal UI (subscription-legal) — PTY capture + deterministic harnessing
- Codex 5.3 is used via the Codex SDK (subscription-friendly) — structured JSONL over stdin/stdout wrapping the CLI
- Everything runs inside isolated devbox containers
- The server is the single source of truth for state, history, patches, and PRs

**Architectural style:** Event-sourced monolith using DBOS for durable execution, PostgreSQL as the system database, file store for large artifacts.

**Deployment target:** Single VPS or home server running Docker. Accessible via responsive web UI from any device.

---

## 2. System Architecture

```
+-----------------------------------------------------------+
|                    Web UI (Next.js)                         |
|  Runs List | Run Detail | Blueprints | Templates | Repos   |
+-----------------------------+-----------------------------+
                              | WebSocket + REST
+-----------------------------+-----------------------------+
|              Patchwork Server (DBOS + Node.js)             |
|                                                             |
|  +------------+  +------------+  +------------+  +--------+ |
|  | Blueprint  |  |   Agent    |  | Patchwork  |  |  Auth  | |
|  |   Engine   |  |  Manager   |  |   Merger   |  | Proxy  | |
|  +-----+------+  +-----+------+  +-----+------+  +---+----+ |
|        |               |               |              |      |
|  +-----+---------------+---------------+--------------+----+ |
|  |              DBOS Durable Execution Layer                | |
|  |     (workflows, steps, checkpoints, events)              | |
|  +----------------------------+----------------------------+ |
|                               |                              |
|  +----------------------------+----------------------------+ |
|  |              PostgreSQL (source of truth)                | |
|  |  runs | steps | patches | events | transcripts           | |
|  +----------------------------+----------------------------+ |
|                               |                              |
|  +----------------------------+----------------------------+ |
|  |           File Store (patches, logs, artifacts)          | |
|  +---------------------------------------------------------+ |
+-----------------------------+-----------------------------+
                              | Docker API + WebSocket
               +--------------+--------------+
               |              |              |
        +------+------+ +----+------+ +-----+-----+
        |  Devbox A   | | Devbox B  | | Devbox C  |
        | (Container) | |(Container)| |(Container)|
        |             | |           | |           |
        | +---------+ | |+---------+| |+---------+|
        | | Sidecar | | || Sidecar || || Sidecar ||
        | |  Agent  | | ||  Agent  || ||  Agent  ||
        | | ------- | | || ------- || || ------- ||
        | | PTY Mgr | | ||Codex SDK|| || PTY Mgr ||
        | | Exec Svc| | ||Exec Svc || ||Exec Svc ||
        | | Git Svc | | ||Git Svc  || ||Git Svc  ||
        | +---------+ | |+---------+| |+---------+|
        |             | |           | |           |
        | [repo clone]| |[repo clone]| [repo clone]|
        +-------------+ +-----------+ +-----------+
```

### Components

| Component | Responsibility |
|-----------|---------------|
| **Blueprint Engine** | DBOS workflows that run blueprint state machines. Each node is a DBOS step. Supports deterministic nodes, agent loop nodes, and loop-back edges. Crash-recoverable. |
| **Agent Manager** | Routes agent work to the right backend (Claude PTY or Codex SDK). Manages agent loop lifecycle, budgets, timeouts, and event streaming. |
| **Patchwork Merger** | Collects patch artifacts from agent nodes, applies them in order using escalating merge strategies, resolves conflicts, creates commits. |
| **Auth Proxy** | OAuth proxy for Claude Code + Codex. Handles login once, shares session tokens with all containers. Monitors token expiry. |
| **Devbox Sidecar** | Runs inside each container. Exposes HTTP API for command execution, PTY management, git operations, file access. |

---

## 3. Devbox Model

### Container Lifecycle

```
PROVISIONING --> READY --> CLAIMED --> RUNNING --> IDLE --> DESTROYED
                                        ^          |
                                        +----------+  (reuse for follow-up)
```

### Devbox Template

A template defines the container image and configuration. Stored in PostgreSQL.

```typescript
interface DevboxTemplate {
  id: string;
  name: string;                    // e.g. "node-20-fullstack"
  baseImage: string;               // e.g. "patchwork/devbox-node:20"
  toolBundles: string[];           // ["node", "python", "go", "rust"]
  envVars: Record<string, string>; // injected at runtime
  bootstrapScripts: string[];     // run after container start
  resourceLimits: {
    cpus: number;                  // e.g. 2
    memoryMB: number;              // e.g. 4096
    diskMB: number;                // e.g. 10240
  };
  networkPolicy: "restricted" | "egress-allowed";
  repos: string[];                 // repos to pre-clone
}
```

### Warm Pool (v2)

For v1: containers spin up on-demand (Docker pull + clone, ~30-60s).
For v2: keep N pre-warmed containers per template, ready to claim instantly (target: under 10s, matching Stripe's standard).

### Sidecar API

HTTP service running inside each container on port 9999:

```
POST /exec           { cmd, args, cwd, timeout }  -> { exitCode, stdout, stderr }
GET  /fs/changed     -> { files: [{ path, status }] }
GET  /fs/read        { path }  -> { content }
POST /fs/write       { path, content }  -> ok
GET  /git/status     -> porcelain v2 output
GET  /git/diff       { paths? }  -> unified diff
POST /git/apply      { patch }  -> { success, conflicts? }
POST /git/commit     { message, files }  -> { sha }
POST /git/push       { remote, branch }  -> ok
POST /pty/start      { cmd, args, env }  -> { sessionId }
POST /pty/write      { sessionId, data }  -> ok
GET  /pty/stream/:id -> WebSocket (raw PTY output)
POST /pty/resize     { sessionId, cols, rows }  -> ok
POST /pty/kill       { sessionId }  -> ok
POST /artifact/save  { kind, data }  -> { artifactId, path }
GET  /health         -> { status, uptime }
```

### Container Security

- No network egress by default (Docker network isolation)
- Repo credentials are short-lived tokens injected at spawn time
- Container rootfs is read-only except /workspace (repo) and /tmp
- No access to host filesystem beyond the repo clone
- Resource limits enforced via Docker cgroup constraints
- All commands logged to the event store via DBOS

---

## 4. Agent Backends

### Common Interface

Both backends implement a unified abstraction:

```typescript
interface AgentBackend {
  type: "claude" | "codex";
  startSession(devboxId: string, config: AgentConfig): Promise<AgentSession>;
  sendTask(session: AgentSession, prompt: string): Promise<void>;
  events(session: AgentSession): AsyncIterable<AgentEvent>;
  terminate(session: AgentSession): Promise<void>;
}

interface AgentConfig {
  role: "implementer" | "reviewer" | "spec_writer" | "ci_fixer";
  budget: { maxTokens?: number; maxTimeSeconds: number };
  allowedTools: string[];
  systemContext: string;
}

type AgentEvent =
  | { type: "message"; content: string }
  | { type: "tool_call"; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; tool: string; result: unknown; exitCode?: number }
  | { type: "done_marker" }
  | { type: "error"; message: string }
  | { type: "budget_exceeded"; reason: "tokens" | "time" }
  | { type: "raw_pty"; data: Buffer; timestamp: number };
```

### Agent Loop (core execution pattern)

Every agent node runs a full agent loop. The agent repeatedly calls tools, observes results, and decides next actions until it signals completion or exhausts its budget. This is the fundamental execution pattern inside both backends:

```typescript
async function agentLoop(
  session: AgentSession,
  task: string,
  devboxId: string,
  config: AgentConfig
): Promise<PatchArtifact[]> {
  await session.sendTask(task);

  for await (const event of session.events()) {
    // Record every event to DBOS event store
    await recordTranscriptEvent(session.runId, event);

    switch (event.type) {
      case "tool_call": {
        // Check tool is in allowlist
        if (!config.allowedTools.includes(event.tool)) {
          await session.sendToolResult({
            error: `Tool '${event.tool}' not allowed in this context`
          });
          continue;
        }
        // Forward to devbox sidecar for execution
        const result = await forwardToolToSidecar(devboxId, event);
        await session.sendToolResult(result);
        break;
      }

      case "done_marker":
        // Agent signaled completion — collect patches from workspace
        return await collectPatches(devboxId);

      case "budget_exceeded":
        // Hard stop — collect whatever patches exist
        await session.terminate();
        return await collectPatches(devboxId);

      case "error":
        // Log and let the agent try to recover (within budget)
        break;
    }
  }

  // PTY exited or stream ended — collect patches
  return await collectPatches(devboxId);
}
```

### Claude Code Backend (PTY-driven)

Claude Code must be used via its terminal UI. We automate it through a PTY session:

```
Server                    Devbox Container
  |                           |
  |  POST /pty/start          |
  |  { cmd: "claude",         |
  |    args: [flags] }        |
  | ------------------------> |
  |                            |  +--------------+
  |   { sessionId: "abc" }     |  | PTY Process  |
  | <------------------------ |  | (claude CLI)  |
  |                            |  +------+-------+
  |  POST /pty/write           |         |
  |  { data: task prompt }     |         |
  | ------------------------> | stdin-->|
  |                            |         |
  |  WS /pty/stream/abc        |         |
  | <========================== stdout--+
  |  (raw PTY output streamed) |
```

**Prompt injection strategy:**

The server types into Claude Code:
1. Task description
2. Explicit constraints: "Generate a git patch using git diff. Save to /workspace/patches/. Do not commit directly."
3. Stop condition: "When tests pass and patch is saved, output PATCHWORK_DONE."

**Completion detection (layered):**

| Layer | Signal | Reliability |
|-------|--------|-------------|
| 1 (primary) | Patch file exists at expected path | High |
| 2 | Claude outputs "PATCHWORK_DONE" marker | Medium |
| 3 | PTY process exits | High |
| 4 | Timeout reached | Fallback |

**What we capture:**
- Raw PTY byte stream (for replay)
- Timestamps per chunk (for timeline reconstruction)
- Parsed markers (PATCHWORK_DONE, errors)
- Final git diff / patch artifacts (primary source of truth)

### Codex Backend (SDK-driven)

Codex uses the structured TypeScript SDK. The SDK wraps the Codex CLI (preserving subscription auth) and communicates via JSONL over stdin/stdout:

```typescript
import Codex from "@openai/codex-sdk";

const codex = new Codex({
  workingDirectory: "/workspace/repo"
});

const thread = await codex.startThread();

for await (const event of thread.runStreamed(taskPrompt)) {
  // Events are natively structured — no PTY parsing needed
  // tool_call events forwarded to devbox sidecar
  // message events stored in transcript
  // turn.completed signals end of agent turn
}
```

Codex also produces patches via the same Patchwork contract — the prompt instructs it to generate git diff patches, not direct commits.

### Dynamic Agent Routing

The Agent Manager routes work based on:
- Language (Ruby -> prefer Claude; TypeScript -> either)
- Task type (creative exploration -> Claude; structured fixes -> Codex)
- Past performance metrics per backend (tracked in PostgreSQL)
- User preference per run (override in run config)
- Availability (if one backend's auth is expired, use the other)

---

## 5. Patchwork System

### Patch Contract

Every agent node must end by producing patch artifacts. This is the fundamental abstraction that enables multi-agent collaboration without conflicts.

```typescript
interface PatchArtifact {
  id: string;
  runId: string;
  stepId: string;
  agentRole: string;
  baseSha: string;
  repo: string;
  files: string[];
  patchContent: string;       // unified diff
  metadata: {
    intentSummary: string;
    confidence: "high" | "medium" | "low";
    risks: string[];
    followups: string[];
  };
  createdAt: Date;
}
```

### Patch Collection

After an agent loop completes, patches are collected deterministically:

1. Check /workspace/patches/ for explicit patch files the agent saved
2. Generate patch from working tree changes via git diff
3. Generate patch from staged changes via git diff --staged
4. Prefer explicit patches, fall back to working tree diff
5. Normalize all patches: strip machine-specific paths, validate they apply from base SHA

### Patch Merge Strategies

When multiple patches need combining (multi-agent or multi-step):

| Strategy | When | How |
|----------|------|-----|
| **Sequential apply** | Patches touch different files | git apply in order, abort on conflict |
| **Three-way merge** | Overlapping files, simple conflicts | git apply --3way, auto-resolve where possible |
| **Agent-assisted merge** | Complex conflicts | Send conflicting chunks to a merger agent to synthesize |

The merge step is a deterministic DBOS step that tries strategies in escalating order.

---

## 6. Blueprints

### What Blueprints Are

Blueprints are state machines that mix deterministic code nodes with agent loop nodes. They are the core orchestration primitive, modeled directly on Stripe's blueprint concept.

Key properties:
- **Deterministic nodes** run code, never an LLM (git, lint, test, push)
- **Agent nodes** run a full agent loop (tool calls until done or budget exhausted)
- **Loop edges** allow retrying a sub-sequence (e.g., lint -> fix lint -> lint again, up to N times)
- **Context engineering** per node: each agent node gets its own system prompt, tool allowlist, and conversation context
- **Crash recovery**: every node is a DBOS step, so runs resume from the last completed step after a crash
- **Full audit trail**: every transition is an event in PostgreSQL
- **Time-travel debugging**: DBOS provenance database allows replaying any run

### Blueprint State Machine

```
                    +------------------+
                    |  Provision Devbox |  <- deterministic
                    +--------+---------+
                             |
                    +--------v---------+
                    |  Implement Task   |  <- agent loop (Claude or Codex)
                    +--------+---------+
                             |
                  +----------v-----------+
              +-->|   Run Linters        |  <- deterministic
              |   +----------+-----------+
              |              |
              |     pass?----+----fail?
              |     |              |
              |     |    +---------v--------+
              |     |    | Fix Lint Errors   |  <- agent loop
              |     |    +---------+--------+
              |     |              |
              |     |   +----------v---------+
              +-----+---| max lint retries?  |  <- deterministic (counter)
                    |    +-------------------+
                    |         (max 3 iterations)
                    |
           +--------v---------+
           |  Review Diff      |  <- agent loop (different agent reviews)
           +--------+---------+
                    |
            has fixes?---+---no fixes
                |              |
       +--------v--------+    |
       | Apply Review     |   |
       | Fixes            |   |  <- agent loop (conditional)
       +--------+--------+    |
                |              |
           +----v--------------v---+
           |  Merge Patches +      |
           |  Commit               |  <- deterministic
           +----------+------------+
                      |
           +----------v-----------+
           |  Push Branch +       |
           |  Trigger CI          |  <- deterministic
           +----------+-----------+
                      |
              pass?---+---fail?
              |              |
              |    +---------v---------+
              |    | Auto-apply CI     |
              |    | Fixes             |  <- deterministic
              |    +---------+---------+
              |              |
              |    +---------v---------+
              |    | Fix CI Failures    |  <- agent loop (max 1 retry)
              |    +---------+---------+
              |              |
              |    +---------v---------+
              |    | Second Push + CI   |  <- deterministic
              |    +---------+---------+
              |              |
              +------+-------+
                     |
           +---------v----------+
           |  Prepare PR Draft   |  <- deterministic
           +---------+----------+
                     |
           +---------v----------+
           |  Destroy Devbox     |  <- deterministic
           +--------------------+
```

### Blueprint as DBOS Workflow

Each blueprint is implemented as a DBOS workflow. Every node becomes a DBOS step with automatic checkpointing:

```typescript
class MinionBlueprint {

  @DBOS.workflow()
  static async run(runId: string, task: TaskSpec): Promise<RunResult> {

    // Step 1: Provision devbox (deterministic)
    const devbox = await DBOS.runStep(
      () => DevboxManager.provision(task.templateId, task.repo)
    );

    // Step 2: Implement task (agent loop)
    await DBOS.runStep(
      () => AgentManager.runAgentLoop({
        devboxId: devbox.id,
        backend: task.preferredBackend,
        role: "implementer",
        prompt: task.description,
        systemContext: buildImplementerContext(task),
        allowedTools: ["file_read", "file_write", "shell", "grep", "glob"],
        budget: { maxTimeSeconds: 600 }
      })
    );

    // Steps 3-4: Lint loop (deterministic + agent, max 3 iterations)
    let lintClean = false;
    for (let i = 0; i < 3 && !lintClean; i++) {
      const lintResult = await DBOS.runStep(
        () => DevboxRunner.lint(devbox.id)
      );
      if (lintResult.success) {
        lintClean = true;
      } else {
        await DBOS.runStep(
          () => AgentManager.runAgentLoop({
            devboxId: devbox.id,
            backend: "codex",
            role: "ci_fixer",
            prompt: formatLintErrors(lintResult),
            systemContext: "Fix lint errors only. Do not change behavior.",
            allowedTools: ["file_read", "file_write"],
            budget: { maxTimeSeconds: 120 }
          })
        );
      }
    }

    // Step 5: Review (agent loop with read-only tools)
    const diff = await DBOS.runStep(() => DevboxRunner.gitDiff(devbox.id));
    const review = await DBOS.runStep(
      () => AgentManager.runAgentLoop({
        devboxId: devbox.id,
        backend: pickReviewer(task),
        role: "reviewer",
        prompt: formatReviewRequest(diff),
        systemContext: buildReviewerContext(task),
        allowedTools: ["file_read", "grep", "glob"],
        budget: { maxTimeSeconds: 180 }
      })
    );

    // Step 6: Apply review fixes if any (conditional agent loop)
    if (review.hasActionableFindings) {
      await DBOS.runStep(
        () => AgentManager.runAgentLoop({
          devboxId: devbox.id,
          backend: task.preferredBackend,
          role: "implementer",
          prompt: formatReviewFindings(review),
          systemContext: "Apply review feedback only.",
          allowedTools: ["file_read", "file_write", "shell"],
          budget: { maxTimeSeconds: 180 }
        })
      );
    }

    // Step 7: Merge patches + commit (deterministic)
    const sha = await DBOS.runStep(
      () => PatchworkMerger.mergeAndCommit(devbox.id, runId)
    );

    // Step 8: Push + CI (deterministic)
    const ci = await DBOS.runStep(
      () => CIManager.pushAndWait(devbox.id, task.branch)
    );

    // Step 9: Fix CI failures (max 1 retry)
    if (!ci.success) {
      await DBOS.runStep(() => CIManager.applyAutofixes(devbox.id, ci));
      await DBOS.runStep(
        () => AgentManager.runAgentLoop({
          devboxId: devbox.id,
          backend: task.preferredBackend,
          role: "ci_fixer",
          prompt: formatCIFailures(ci),
          systemContext: buildCIFixerContext(task, ci),
          allowedTools: ["file_read", "file_write", "shell", "grep"],
          budget: { maxTimeSeconds: 300 }
        })
      );
      await DBOS.runStep(() => PatchworkMerger.mergeAndCommit(devbox.id, runId));
      await DBOS.runStep(() => CIManager.pushAndWait(devbox.id, task.branch));
    }

    // Step 10: Create PR (deterministic)
    const pr = await DBOS.runStep(
      () => PRManager.createDraft(runId, task, sha)
    );

    // Step 11: Cleanup (deterministic)
    await DBOS.runStep(() => DevboxManager.destroy(devbox.id));

    return { runId, prUrl: pr.url, status: "completed" };
  }
}
```

### Context Engineering Per Node

Each agent node gets tailored context to constrain its behavior:

- **Implementer**: full repo rules (CLAUDE.md, .cursorrules), Patchwork constraints, task context
- **Reviewer**: repo rules, read-only role enforcement, structured output format for findings
- **CI Fixer**: repo rules, focused role ("fix failures only, do not refactor"), failing test details

### Blueprint as Data (custom blueprints)

For user-defined blueprints, the DAG is stored as JSON:

```typescript
interface BlueprintDefinition {
  id: string;
  name: string;
  version: number;
  description: string;
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
}

interface BlueprintNode {
  id: string;
  type: "deterministic" | "agent";
  label: string;
  command?: string;                 // for deterministic nodes
  agentConfig?: {
    preferredBackends: ("claude" | "codex")[];
    role: string;
    promptTemplate: string;         // with placeholders like {{task}}, {{diff}}
    systemContextTemplate: string;
    allowedTools: string[];
    budget: { maxTokens?: number; maxTimeSeconds: number };
  };
  retryPolicy?: { maxRetries: number; backoffMs: number };
}

interface BlueprintEdge {
  from: string;
  to: string;
  condition: "on_success" | "on_failure" | "on_timeout" | "always";
}
```

The Blueprint Engine interprets this JSON and generates DBOS workflow calls dynamically, including loop edges.

### Built-in Blueprints

**Pattern A: Minion (full pipeline)**
```
Implement -> [Lint -> Fix Lint] x3 -> Review -> Apply Fixes -> Commit -> Push -> CI -> [Fix CI] x1 -> PR
```

**Pattern B: Writer + Reviewer**
```
Implement (Claude) -> Review (Codex) -> Apply Fixes -> Commit -> Push -> CI -> PR
```

**Pattern C: Spec -> Implement -> Review**
```
Write Spec (Claude) -> Implement (Codex) -> Review (Claude) -> Commit -> Push -> CI -> PR
```

---

## 7. Multi-Agent Patterns

Multi-agent runs use different devboxes (or sequential sessions in the same devbox) for each agent. The Patchwork contract ensures they do not interfere.

### Agent Roles

| Role | Purpose | Default Backend | Tools |
|------|---------|----------------|-------|
| **Implementer** | Write code to fulfill the task | Claude or Codex | file_read, file_write, shell, grep, glob |
| **Reviewer** | Review diffs for correctness and style | Opposite of implementer | file_read, grep, glob (read-only) |
| **Spec Writer** | Produce a spec + acceptance test list | Claude (creative) | file_read, file_write, grep, glob |
| **CI Fixer** | Fix lint errors and failing tests | Codex (structured) | file_read, file_write, shell |
| **Patch Merger** | Resolve complex merge conflicts | Claude (reasoning) | file_read, file_write, git_diff |

---

## 8. Data Model

### PostgreSQL Schema

DBOS manages its own system tables for workflow state. These are the application tables:

```sql
CREATE TABLE devbox_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL UNIQUE,
  base_image      TEXT NOT NULL,
  tool_bundles    JSONB NOT NULL DEFAULT '[]',
  env_vars        JSONB NOT NULL DEFAULT '{}',
  bootstrap       JSONB NOT NULL DEFAULT '[]',
  resource_limits JSONB NOT NULL,
  network_policy  TEXT NOT NULL DEFAULT 'restricted',
  repos           JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status           TEXT NOT NULL DEFAULT 'pending',
  blueprint_id     TEXT NOT NULL,
  repo             TEXT NOT NULL,
  base_sha         TEXT,
  branch           TEXT,
  task_description TEXT NOT NULL,
  created_by       TEXT,
  devbox_id        UUID,
  pr_url           TEXT,
  config           JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- run.status values:
--   pending | provisioning | running | waiting_ci
--   completed | failed | cancelled

CREATE TABLE devboxes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   UUID REFERENCES devbox_templates(id),
  status        TEXT NOT NULL DEFAULT 'provisioning',
  container_id  TEXT,
  host          TEXT,
  repo_checkout TEXT,
  run_id        UUID,
  last_seen_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- devbox.status values:
--   provisioning | ready | claimed | running
--   idle | destroyed | failed

CREATE TABLE run_steps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES runs(id),
  node_id       TEXT NOT NULL,
  node_type     TEXT NOT NULL,
  agent_backend TEXT,
  agent_role    TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  iteration     INTEGER DEFAULT 0,
  started_at    TIMESTAMPTZ,
  ended_at      TIMESTAMPTZ,
  duration_ms   INTEGER,
  output        JSONB,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- run_steps.status values:
--   pending | running | completed | failed | skipped

CREATE TABLE patches (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id         UUID NOT NULL REFERENCES runs(id),
  step_id        UUID REFERENCES run_steps(id),
  agent_role     TEXT NOT NULL,
  base_sha       TEXT NOT NULL,
  files          JSONB NOT NULL,
  intent_summary TEXT,
  confidence     TEXT DEFAULT 'medium',
  risks          JSONB DEFAULT '[]',
  patch_path     TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transcript_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id        UUID NOT NULL REFERENCES runs(id),
  step_id       UUID REFERENCES run_steps(id),
  event_type    TEXT NOT NULL,
  agent_backend TEXT,
  content       JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- event_type values:
--   agent_message | tool_call | tool_result
--   blueprint_transition | ci_event | patch_created
--   error | marker | done_marker | budget_exceeded

CREATE TABLE artifacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID NOT NULL REFERENCES runs(id),
  step_id     UUID REFERENCES run_steps(id),
  kind        TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- artifact.kind values:
--   patch | lint | test | ci | pty_log

CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_runs_created_by ON runs(created_by);
CREATE INDEX idx_run_steps_run_id ON run_steps(run_id);
CREATE INDEX idx_patches_run_id ON patches(run_id);
CREATE INDEX idx_transcript_run_id ON transcript_events(run_id);
CREATE INDEX idx_transcript_created ON transcript_events(created_at);
CREATE INDEX idx_artifacts_run_id ON artifacts(run_id);
```

### File Store Layout

```
/data/patchwork/
  patches/{run_id}/
    patch-001-implementer.patch
    patch-002-lint-fix.patch
    patch-003-reviewer.patch
  pty_logs/{run_id}/
    step-{id}-claude-raw.log
    step-{id}-claude-timing.jsonl
  ci_logs/{run_id}/
    ci-run-{n}.log
  artifacts/{run_id}/
    lint-output.json
    test-results.xml
    coverage.json
```

---

## 9. Server API

### Run Control

```
POST   /api/runs                     Create a new run
GET    /api/runs                     List runs (filter: status, repo, creator)
GET    /api/runs/:id                 Run detail
POST   /api/runs/:id/cancel          Cancel a run
POST   /api/runs/:id/retry/:stepId   Retry a specific step
```

### Real-time Streaming

```
WS     /api/runs/:id/stream          Step events + PTY chunks
GET    /api/runs/:id/transcript       Full transcript (paginated)
```

### Patches and Diffs

```
GET    /api/runs/:id/patches          List patches
GET    /api/runs/:id/diff             Combined diff
POST   /api/runs/:id/apply-patches    Trigger merge + commit
```

### Devboxes

```
GET    /api/devboxes                  List active devboxes
POST   /api/devboxes                  Create (from template)
DELETE /api/devboxes/:id              Destroy
GET    /api/devboxes/:id/status       Status + resource usage
```

### Templates

```
GET    /api/templates                 List
POST   /api/templates                 Create
PUT    /api/templates/:id             Update
DELETE /api/templates/:id             Delete
```

### Blueprints

```
GET    /api/blueprints                List
POST   /api/blueprints                Create custom
GET    /api/blueprints/:id            Detail + DAG data
```

### Artifacts

```
GET    /api/runs/:id/artifacts        List
GET    /api/artifacts/:id/download    Download
```

### Auth

```
GET    /api/auth/status               Auth proxy status
POST   /api/auth/claude/login         Initiate Claude OAuth
POST   /api/auth/codex/login          Initiate Codex auth
```

---

## 10. Web UI

### Tech Stack

- Next.js 15 (App Router)
- Tailwind CSS + shadcn/ui
- WebSocket for real-time streaming
- Monaco Editor for diff viewing
- Responsive: phone, tablet, desktop

### Pages

| Route | Purpose |
|-------|---------|
| /runs | Runs list (primary dashboard) |
| /runs/:id | Run detail (transcript + diffs + blueprint) |
| /runs/new | Create new run form |
| /devboxes | Active devboxes list |
| /templates | Devbox template management |
| /blueprints | Blueprint library + editor |
| /blueprints/:id | Blueprint detail + DAG visualizer |
| /settings | Auth status, preferences, secrets |

### Runs List (/runs)

Card-based list showing all runs with:
- Status badge (RUNNING, WAITING_CI, COMPLETED, FAILED)
- Repo + branch
- Agent backend indicator
- Current blueprint node label
- Last agent message preview
- Time since start
- Quick actions menu (stop, extend TTL, view logs)

Mobile: cards stack vertically, swipe for actions.
Desktop: table layout option.

### Run Detail (/runs/:id)

**Desktop: split pane**
- Left: Transcript feed (agent messages, tool events, blueprint transitions)
- Right: Tabbed workspace (Changed Files, Patches, CI, Metadata)
- Bottom: Blueprint progress DAG widget
- Top-right: Primary CTA ("Create PR" when ready)

**Mobile: tabbed layout**
- Segmented control: Transcript | Diffs | CI | Patches
- Blueprint shown as progress bar
- Create PR as sticky bottom button

### Blueprint Visualizer Widget

Interactive DAG at bottom of run detail page:
- Completed nodes: green checkmark
- Current node: pulsing blue
- Failed nodes: red X
- Future nodes: gray outline
- Loop edges shown as curved arrows with iteration count
- Click node to jump to that step in transcript

### New Run Form

Fields: Repository, Branch, Template, Blueprint, Task (textarea), Agent preference (Auto/Claude/Codex/Claude+Codex).

---

## 11. Auth Proxy

### Claude Code Auth Flow

1. Admin visits /settings and clicks "Connect Claude Code"
2. Server opens Claude Code OAuth in browser (one-time)
3. Claude Code stores session in ~/.claude/
4. Server captures and encrypts the auth config
5. On devbox creation: inject auth config into container ~/.claude/
6. Claude Code in container starts pre-authenticated
7. Server monitors token expiry, prompts refresh when needed

### Codex Auth Flow

1. Admin visits /settings and clicks "Connect Codex"
2. Server stores Codex CLI auth (OAuth or API key)
3. On devbox creation: inject auth into container environment
4. Codex SDK in container picks up auth automatically

### Token Management

- Tokens stored encrypted in PostgreSQL (AES-256-GCM)
- Short-lived injection: copied to container at startup, wiped on destroy
- Server tracks expiry and alerts when refresh needed
- Tokens never exposed to UI or API responses

---

## 12. Security Model

| Layer | Control |
|-------|---------|
| **Network** | No egress by default. Only sidecar-to-server allowed. Git push to configured remotes only. |
| **Filesystem** | Read-only rootfs except /workspace and /tmp. No host access. |
| **Credentials** | Short-lived scoped tokens. Encrypted at rest. Wiped on destroy. |
| **Resources** | CPU, memory, disk per container. Time + token budgets per agent step. |
| **Tool gating** | Agent steps use allowlisted tools. Deterministic steps run broader commands. |
| **Audit** | Every action logged as DBOS event. Immutable history in PostgreSQL. |

### Threat Model

| Risk | Mitigation |
|------|-----------|
| Agent runs destructive commands | Container isolation + readonly rootfs + resource limits |
| Agent exfiltrates code | No network egress; git push only to configured remotes |
| Token leak via agent output | Auth config in protected paths agents cannot access |
| Agent makes destructive API calls | No external API access (no egress) |
| Server compromise | Auth tokens encrypted; DB credentials scoped; container API uses mTLS |

---

## 13. Build Order

### Phase 1: Foundation

1. Devbox sidecar (Node.js: exec, fs, git endpoints)
2. Docker container management (create, destroy, health)
3. Server skeleton (DBOS + PostgreSQL + REST API)
4. Devbox template CRUD

### Phase 2: Single Agent

5. Claude PTY harness (start, stream, write, completion detection)
6. Codex SDK integration (start thread, stream events, tool proxy)
7. Agent loop implementation (tool forwarding, budget enforcement, event recording)
8. Patchwork: generate + store patches
9. Simple blueprint: Implement then Commit then Push (3 steps)

### Phase 3: Full Pipeline

10. Blueprint engine (DBOS workflow, loop edges, conditional transitions)
11. Lint loop (deterministic lint + agent fix + retry counter, max 3)
12. Review agent node (read-only tools, structured findings)
13. CI integration (push, poll, auto-apply fixes, feed failures back)
14. Patch merging (sequential + three-way + agent-assisted)

### Phase 4: UI

15. Runs list page (filterable, live status)
16. Run detail page (transcript + diffs + blueprint widget)
17. New run form
18. WebSocket streaming for live updates
19. Templates + blueprints management pages

### Phase 5: Polish

20. Auth proxy (Claude + Codex OAuth, token rotation)
21. Multi-agent patterns (writer+reviewer, spec into implement into review)
22. Dynamic agent routing
23. Warm pool (pre-provisioned containers)
24. Settings page + secrets management
25. Blueprint DAG editor (visual)

---

## 14. Acceptance Criteria

A complete v1 run must:

- [ ] Create a devbox from a template
- [ ] Checkout repo at specified SHA
- [ ] Run an agent loop (Claude or Codex) to implement a change
- [ ] Agent loop: tool calls forwarded to sidecar, events recorded, budget enforced
- [ ] Produce patch artifacts (not direct commits)
- [ ] Run linters locally, loop up to 3 times with agent fixes
- [ ] Have a review agent check the diff (with read-only tools)
- [ ] Apply patches, commit, push branch
- [ ] Trigger CI and report results
- [ ] If CI fails: auto-apply fixes, run one agent fix loop, push again (max 2 CI cycles)
- [ ] Generate PR text + summary + artifacts
- [ ] All steps visible in web UI with live WebSocket streaming
- [ ] All events recorded in PostgreSQL via DBOS (crash-recoverable, replayable)
- [ ] Blueprint progress visualized as interactive DAG
- [ ] Accessible from phone browser (responsive layout)

---

## 15. Technology Summary

| Component | Technology |
|-----------|-----------|
| Server runtime | Node.js + TypeScript |
| Durable execution | DBOS Transact (TypeScript SDK) |
| Database | PostgreSQL |
| Web framework | Next.js 15 (App Router) |
| UI components | Tailwind CSS + shadcn/ui |
| Diff viewer | Monaco Editor |
| Real-time | WebSocket (native) |
| Containers | Docker (via dockerode SDK) |
| Claude Code | PTY capture (node-pty) |
| Codex | @openai/codex-sdk |
| File storage | Local filesystem (/data/patchwork/) |
| Auth encryption | AES-256-GCM |
