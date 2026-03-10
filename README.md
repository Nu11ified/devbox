# Patchwork

Patchwork is a self-hosted platform that runs AI coding agents inside isolated Docker containers. You give it a task description, a repository, and a branch. It spins up one or more agents (Claude or Codex), has them write code inside ephemeral containers, collects the resulting patches, and can push the branch. An orchestrator polls an issue board, dispatches work to available slots, and handles retries automatically. Each thread gets its own git worktree for isolation, and completed work can be merged via per-thread PRs or a combined integration branch.

Patchwork supports both **interactive sessions** (human-in-the-loop with tool approvals) and **autonomous dispatch** (unattended batch processing) through a unified provider adapter system. Interactive sessions stream real-time content, tool calls, and approval requests over WebSocket.

## Requirements

- [Bun](https://bun.sh) (v1.3+)
- Docker
- PostgreSQL 17
- Redis 7 (for caching)
- Node.js 20 (for runtime in Docker images)

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

### Projects

Projects are the central organizing unit. Each project is linked to a GitHub repository and branch. Projects contain threads (agent sessions) and issues. Create a project from the Projects page by selecting a repo and giving it a name.

- **Project sidebar** -- Contextual left sidebar showing threads, issues, and archived items for the current project.
- **Project-scoped threads** -- Each thread belongs to a project and gets its own git worktree for isolated code changes.
- **PR creation** -- Create per-thread PRs or merge all branches via an integration PR from the project view.

### Kanban Board

The issue board shows all tasks across five columns: Open, Queued, In Progress, Review, and Done. Each card shows priority, labels, project info, GitHub links, and active thread status with live indicators. Drag-and-drop or click to transition issues between columns. Cards for completed or cancelled issues can be archived directly from the board.

### Interactive Threads

Start an interactive session from any issue on the board or create one directly from a project. Threads provide a chat-style interface with real-time streaming of agent output, inline tool call details, and approval cards for reviewing file changes and command execution. Choose between `approval-required` mode (review each tool call) and `full-access` mode (auto-approve everything).

The thread view includes:
- **Timeline** -- Streaming assistant responses, user messages, and inline work items (file reads/writes, commands).
- **Approval cards** -- Allow, Allow All, or Deny tool calls with full context.
- **Diff panel** -- Syntax-highlighted file diffs from agent changes.
- **Terminal drawer** -- Real-time command output.

### Archive & Search

Completed and cancelled issues are automatically archived after 24 hours. The global Archive page provides full-text search across archived issues and past thread transcripts. Search results include highlighted snippets and link directly to the original thread. Per-project archive sections are also available in the project sidebar.

When autonomous agents are dispatched, relevant context from past archived threads is automatically injected into their prompts to improve continuity.

### Plugin Marketplace

The Plugins page syncs with the official [Anthropic Claude Code plugin marketplace](https://github.com/anthropics/claude-plugins-official). Plugin metadata (name, description, author, category, version) is fetched every 6 hours from the marketplace registry. Anthropic-verified plugins are marked with a badge. Install plugins to enable them for your agents -- installed plugin instructions are written to the workspace CLAUDE.md before each agent session.

### Provider Adapters

Patchwork uses a provider adapter system to support multiple AI coding agents behind a unified interface. Each adapter translates provider-specific SDK events into a canonical event model. Currently supported:

- **Claude Code** -- Full implementation via `@anthropic-ai/claude-agent-sdk`. Supports interactive approvals, plan mode, resume, model switching, and plugin instructions.
- **Codex** -- Stub adapter (planned).

Adapters are registered at startup and routed per-thread. Adding a new provider means implementing the `ProviderAdapterShape` interface.

### Claude Code SDK Integration

Full integration with `@anthropic-ai/claude-agent-sdk` across 18 feature areas:

**Agent Execution**
- **Streaming** -- Token-level streaming via `includePartialMessages`, fan-out over WebSocket
- **Multi-turn conversations** -- Persistent sessions with history and `continue` support
- **Session forking** -- Fork any thread into a parallel session (`forkSession: true`)
- **Effort levels** -- Configurable agent effort (`low`, `medium`, `high`) per query
- **Structured output** -- JSON schema output format passthrough to SDK

**Custom Tools & Skills**
- **Custom MCP tools** -- In-process MCP server with Patchwork-specific tools: `patchwork_get_project`, `patchwork_list_threads`, `patchwork_list_issues`, `patchwork_create_issue`, `patchwork_update_thread_title`
- **Tool classification** -- Categorizes tools (file, shell, search, mcp, todo, subagent) for UI display and permission gating
- **Slash commands** -- Auto-provisioned `/review`, `/test`, `/commit`, `/pr`, `/fix` in workspace `.claude/commands/`
- **Skills** -- Project-context and code-quality skills in `.claude/skills/`
- **Workspace config** -- Auto-generated `.claude/settings.json` with default permissions

**Subagents**
- **Specialist subagents** -- 5 built-in agent definitions dispatched via the Agent tool: `code-reviewer`, `test-writer`, `security-auditor`, `refactorer`, `researcher`

**Safety & Hooks**
- **Programmatic hooks** -- `PreToolUse`, `PostToolUse`, `Notification`, `SubagentStart`, `SubagentStop`, `Stop` callbacks
- **Dangerous command blocking** -- Regex-based detection of `rm -rf /`, fork bombs, pipe-to-shell, force push to main
- **Protected path enforcement** -- Blocks writes to `/etc/`, `/usr/`, `.env`, credentials, and secrets files
- **Audit logging** -- All tool invocations logged with tool name, timestamp, and approval status

**File Checkpointing**
- **Automatic checkpoints** -- `enableFileCheckpointing: true` tracks file state at each tool use
- **Rewind support** -- `rewindFiles(checkpointId)` via WebSocket command with one-click UI button

**Todo Tracking & Interactive Q&A**
- **TodoWrite detection** -- Intercepts `TodoWrite` tool_use blocks, streams live todo progress to UI timeline
- **AskUserQuestion** -- Agent asks clarifying questions with multiple-choice options, rendered as interactive cards

**Secure Deployment**
- **Container hardening** -- `--cap-drop ALL`, `no-new-privileges`, PID limits (256), tmpfs `/tmp`
- **Resource limits** -- 2GB memory, 2 CPU cores per devbox container
- **Non-root execution** -- Devbox containers run as `agent` user (uid 1000)
- **Network isolation** -- Default `NetworkMode: "none"` for sandboxed execution
- **Credential proxying** -- `ANTHROPIC_BASE_URL` passthrough for API key isolation

### Agent Subscriptions

During onboarding, you can enable Claude or OpenAI subscriptions. When enabled, agents run with the `--subscription` flag, using your subscription instead of API keys.

### Command Palette

Press `Cmd+K` (or `Ctrl+K`) to open the command palette. Fuzzy search across projects, threads, and actions. Navigate anywhere or trigger common operations without leaving the keyboard.

### Redis Caching

GitHub API responses are cached in Redis with three TTL tiers:
- **Fast** (5 min): Issue lists, frequently changing data
- **Medium** (1 hour): Repository lists
- **Slow** (24 hours): Rarely changing metadata

## Concepts

**Project** -- A workspace linked to a GitHub repository and branch. Projects group threads and issues together and provide the context for agent work.

**Thread** -- An interactive or autonomous agent session. Threads belong to a project, track turns and events, and optionally link to an issue. Each thread gets its own git worktree for isolated code changes.

**Issue** -- A task on the board. Issues have status, priority (0=urgent to 3=low), labels, and belong to a project. Can be created manually, imported from GitHub, or auto-synced. Issues are automatically archived 24 hours after completion.

**Orchestrator** -- A poll loop that dispatches queued issues, detects stalled runs, and retries failures with exponential backoff.

**Provider Adapter** -- An implementation of `ProviderAdapterShape` that wraps a specific AI agent SDK (Claude Code, Codex). Adapters emit canonical `ProviderRuntimeEvent`s for session lifecycle, content streaming, tool calls, and approvals.

**Plugin** -- A Claude Code plugin from the Anthropic marketplace. Plugins provide specialized skills, workflows, and tools to agents. Synced automatically from the official registry.

**Devbox** -- An ephemeral Docker container where agents run. Each devbox has a sidecar process that exposes filesystem, git, shell exec, and PTY endpoints over HTTP.

**Template** -- A named configuration for devbox creation: base Docker image, resource limits, environment variables, bootstrap scripts, and network policy.

## Project structure

The repo is a Bun monorepo with four packages:

- `packages/server` -- Express API server with Prisma ORM, Redis caching, GitHub integration, provider adapter system, orchestrator, plugin sync, archive system, and project/thread APIs.
- `packages/sidecar` -- Lightweight HTTP server that runs inside each devbox container.
- `packages/ui` -- Next.js 16 web interface with GitHub OAuth, kanban board, project management, interactive thread UI, plugin marketplace, archive search, command palette, and settings.
- `packages/shared` -- TypeScript type definitions shared across packages.

## Architecture

```
Browser ──> Next.js (port 3000)
              ├── /login              → GitHub OAuth sign-in
              ├── /api/auth/*         → better-auth (OAuth flow, sessions)
              ├── /api/*              → proxy to Express server
              ├── /board              → Kanban board with drag-and-drop
              ├── /projects           → Project list + creation
              ├── /projects/[id]      → Project detail with sidebar
              ├── /projects/[id]/threads/[id] → Interactive thread UI (WebSocket)
              ├── /archive            → Global archive search
              ├── /plugins            → Plugin marketplace (synced from Anthropic)
              ├── /settings           → User settings + subscriptions
              └── /onboarding         → Repo selection + subscription setup

Express Server (port 3001)
              ├── WebSocket server (thread events, commands, approvals)
              ├── Session middleware (validates better-auth cookies)
              ├── ProviderService (Effect-TS, thread routing)
              │     ├── ProviderAdapterRegistry
              │     │     ├── ClaudeCodeAdapter (@anthropic-ai/claude-agent-sdk)
              │     │     └── CodexAdapter (stub)
              │     └── Thread persistence (Prisma)
              ├── /api/projects/*  → Project CRUD, threads, PRs, merge
              ├── /api/threads/*   → Thread CRUD + turn management
              ├── /api/issues/*    → Issue CRUD + dispatch
              ├── /api/plugins/*   → Plugin marketplace + install/uninstall
              ├── /api/archive/*   → Full-text archive search
              ├── /api/github/*    → GitHub API (repos, issues, import, sync)
              ├── /api/settings/*  → User settings CRUD
              ├── Orchestrator     → Auto-dispatch + stall detection
              ├── GitHubSyncJob    → Issue sync every 5 min
              ├── PluginSyncJob    → Marketplace sync every 6 hours
              └── ArchiveJob       → Auto-archive completed issues

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
