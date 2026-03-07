# Patchwork

Patchwork is a self-hosted platform that runs AI coding agents inside isolated Docker containers. You give it a task description, a repository, and a branch. It spins up one or more agents (Claude or Codex), has them write code inside ephemeral containers, collects the resulting patches, and can push the branch. Workflows are defined as directed graphs called blueprints, which chain together agent steps, linting, testing, review, and CI polling. An orchestrator polls an issue board, dispatches work to available slots, and handles retries automatically.

Patchwork supports both **interactive sessions** (human-in-the-loop with tool approvals) and **autonomous dispatch** (unattended batch processing) through a unified provider adapter system. Interactive sessions stream real-time content, tool calls, and approval requests over WebSocket. Each thread gets its own git worktree for isolation.

## Requirements

- [Bun](https://bun.sh) (v1.3+)
- Docker
- PostgreSQL 17
- Redis 7 (for caching)
- Node.js 20 (for runtime in Docker images)
- [Effect-TS](https://effect.website) (bundled, used for provider adapter layer)

## Installation

```
git clone https://github.com/Nu11ified/devbox.git
cd devbox
bun install
```

## Configuration

Copy `.env.example` to `.env` and fill in the values:

```
cp .env.example .env
```

### GitHub OAuth Setup

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Create a new OAuth App:
   - **Application name:** Patchwork
   - **Homepage URL:** `https://your-domain` (or `http://localhost:3000` for dev)
   - **Authorization callback URL:** `https://your-domain/api/auth/callback/github`
3. Copy the Client ID and Client Secret to your `.env`:
   ```
   GITHUB_CLIENT_ID=your_client_id
   GITHUB_CLIENT_SECRET=your_client_secret
   ```
4. Generate a better-auth secret:
   ```
   openssl rand -base64 32
   ```

### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `GITHUB_CLIENT_ID` | GitHub OAuth app client ID. | (required) |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth app client secret. | (required) |
| `BETTER_AUTH_SECRET` | Session signing secret. Generate with `openssl rand -base64 32`. | (required) |
| `BETTER_AUTH_URL` | Base URL for auth callbacks. | `http://localhost:3000` |
| `UI_ORIGIN` | Trusted origin for CORS. | `http://localhost:3000` |
| `PATCHWORK_USERNAME` | Basic auth username (fallback). Leave empty to disable. | (empty) |
| `PATCHWORK_PASSWORD` | Basic auth password (fallback). | (empty) |
| `PATCHWORK_ENCRYPTION_KEY` | 32-byte hex key for encrypting stored API tokens. Generate with `openssl rand -hex 32`. | (random) |
| `POSTGRES_USER` | PostgreSQL user. | `patchwork` |
| `POSTGRES_PASSWORD` | PostgreSQL password. | `patchwork` |
| `POSTGRES_DB` | PostgreSQL database name. | `patchwork` |
| `DATABASE_URL` | Full PostgreSQL connection string. | Auto-constructed |
| `REDIS_URL` | Redis connection string. | `redis://localhost:6379` |
| `SERVER_PORT` | Host port for the API server. | `3001` |
| `UI_PORT` | Host port for the web UI. | `3000` |
| `PATCHWORK_POLL_INTERVAL_MS` | Orchestrator poll interval (ms). | `5000` |
| `PATCHWORK_MAX_CONCURRENT` | Max concurrent dispatched issues. | `5` |
| `PATCHWORK_STALL_TIMEOUT_MS` | Stall detection timeout (ms). `0` to disable. | `600000` |

## Usage

### With Docker Compose

```
docker compose up --build
```

This starts PostgreSQL, Redis, the API server, and the web UI. The UI is available at `http://localhost:3000`.

### Local development

Start PostgreSQL and Redis separately (or use the compose file for just the services), then:

```
bun run dev:server
bun run dev:ui
```

The server runs on port 3001, the UI on port 3000.

## Features

### GitHub OAuth

Sign in with your GitHub account. Patchwork uses the `repo` scope to access your repositories and issues. Session management is handled by [better-auth](https://better-auth.com) with automatic session refresh.

### GitHub Issue Sync

Issues labeled `patchwork` in your connected repositories are automatically synced to the board every 5 minutes. You can also manually import issues from any of your repositories using the "Import from GitHub" dialog on the board page.

### Kanban Board

The issue board shows all tasks across five columns: Open, Queued, In Progress, Review, and Done. Each card shows priority, labels, repository info, GitHub links, and timestamps. Click any card to see the full issue detail view with actions, error history, and run links.

### Interactive Threads

Start an interactive session from any issue on the board or create one directly at `/threads`. Threads provide a chat-style interface with real-time streaming of agent output, inline tool call details, and approval cards for reviewing file changes and command execution. Choose between `approval-required` mode (review each tool call) and `full-access` mode (auto-approve everything).

The thread view includes:
- **Timeline** -- Streaming assistant responses, user messages, and inline work items (file reads/writes, commands).
- **Approval cards** -- Allow, Allow All, or Deny tool calls with full context.
- **Diff panel** -- Syntax-highlighted file diffs from agent changes.
- **Terminal drawer** -- Real-time command output.

### Provider Adapters

Patchwork uses a provider adapter system to support multiple AI coding agents behind a unified interface. Each adapter translates provider-specific SDK events into a canonical event model. Currently supported:

- **Claude Code** -- Full implementation via `@anthropic-ai/claude-code` SDK. Supports interactive approvals, plan mode, resume, and model switching.
- **Codex** -- Stub adapter (planned).

Adapters are registered at startup and routed per-thread. Adding a new provider means implementing the `ProviderAdapterShape` interface.

### Agent Subscriptions

During onboarding, you can enable Claude or OpenAI subscriptions. When enabled, agents run with the `--subscription` flag, using your subscription instead of API keys.

### Redis Caching

GitHub API responses are cached in Redis with three TTL tiers:
- **Fast** (5 min): Issue lists, frequently changing data
- **Medium** (1 hour): Repository lists
- **Slow** (24 hours): Rarely changing metadata

## Concepts

**Devbox** -- An ephemeral Docker container where agents run. Each devbox has a sidecar process that exposes filesystem, git, shell exec, and PTY endpoints over HTTP.

**Template** -- A named configuration for devbox creation: base Docker image, resource limits, environment variables, bootstrap scripts, and network policy.

**Blueprint** -- A directed graph that defines a workflow. Built-in blueprints:

- `simple` -- Implement, lint, review.
- `minion` -- Full pipeline with fix loops, testing, CI polling.
- `writer-reviewer` -- Write + review with fix loop.
- `spec-implement-review` -- Spec writing, implementation, review.

**Issue** -- A task on the board. Issues have status, priority (0=urgent to 3=low), target repo/branch, and a blueprint. Can be created manually, imported from GitHub, or auto-synced.

**Orchestrator** -- A poll loop that dispatches queued issues, detects stalled runs, and retries failures with exponential backoff.

**Run** -- A single execution of a blueprint. Tracks status, transcript events, and patch artifacts.

**Thread** -- An interactive or autonomous agent session. Threads are bound to a provider adapter, track turns and events, and optionally link to an issue. Each thread gets its own git worktree for isolated code changes.

**Provider Adapter** -- An implementation of `ProviderAdapterShape` that wraps a specific AI agent SDK (Claude Code, Codex). Adapters emit canonical `ProviderRuntimeEvent`s for session lifecycle, content streaming, tool calls, and approvals.

## Project structure

The repo is a Bun monorepo with four packages:

- `packages/server` -- Express API server with Prisma ORM, Redis caching, GitHub integration, provider adapter system, orchestrator, and issue board API.
- `packages/sidecar` -- Lightweight HTTP server that runs inside each devbox container.
- `packages/ui` -- Next.js web interface with GitHub OAuth, kanban board, interactive thread UI, live transcripts, blueprint DAG visualization, and settings.
- `packages/shared` -- TypeScript type definitions shared across packages.

## Architecture

```
Browser ──> Next.js (port 3000)
              ├── /login          → GitHub OAuth sign-in
              ├── /api/auth/*     → better-auth (OAuth flow, sessions)
              ├── /api/*          → proxy to Express server
              ├── /threads/[id]   → Interactive thread UI (WebSocket)
              ├── /board          → kanban board with GitHub import
              └── /onboarding     → repo selection + subscription setup

Express Server (port 3001)
              ├── WebSocket server (thread events, commands, approvals)
              ├── session middleware (validates better-auth cookies)
              ├── ProviderService (Effect-TS, thread routing)
              │     ├── ProviderAdapterRegistry
              │     │     ├── ClaudeCodeAdapter (@anthropic-ai/claude-code)
              │     │     └── CodexAdapter (stub)
              │     └── Thread persistence (Prisma)
              ├── /api/github/*   → GitHub API (repos, issues, import, sync)
              ├── /api/settings/* → user settings CRUD
              ├── /api/threads/*  → thread CRUD + turn management
              ├── /api/issues/*   → issue CRUD + dispatch
              ├── /api/runs/*     → run management
              └── Orchestrator    → auto-dispatch + GitHub sync

              ┌─────────┴─────────┐
              PostgreSQL          Redis
              (Prisma ORM)        (GitHub API cache)
```

## Running tests

```
bun run test
```

Or for a specific package:

```
bun run --filter @patchwork/server test
bun run --filter @patchwork/sidecar test
```

## License

No license specified.
