# Patchwork

Patchwork is a self-hosted platform that runs AI coding agents inside isolated Docker containers. You give it a task description, a repository, and a branch. It spins up one or more agents (Claude or Codex), has them write code inside ephemeral containers, collects the resulting patches, and can push the branch. Workflows are defined as directed graphs called blueprints, which chain together agent steps, linting, testing, review, and CI polling.

## Requirements

- [Bun](https://bun.sh) (v1.3+)
- Docker
- PostgreSQL 17
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

| Variable | Description | Default |
|---|---|---|
| `PATCHWORK_USERNAME` | Basic auth username for the server. Leave empty to disable auth. | (empty) |
| `PATCHWORK_PASSWORD` | Basic auth password. | (empty) |
| `PATCHWORK_ENCRYPTION_KEY` | 32-byte hex key for encrypting stored API tokens. Generate with `openssl rand -hex 32`. Random key used if unset (tokens won't survive restarts). | (empty) |
| `POSTGRES_USER` | PostgreSQL user. | `patchwork` |
| `POSTGRES_PASSWORD` | PostgreSQL password. | `patchwork` |
| `POSTGRES_DB` | PostgreSQL database name. | `patchwork` |
| `SERVER_PORT` | Host port for the API server. | `3001` |
| `UI_PORT` | Host port for the web UI. | `3000` |

Agent API keys (for Claude and Codex) are configured through the Settings page in the web UI. They are encrypted at rest using the encryption key above.

## Usage

### With Docker Compose

```
docker compose up --build
```

This starts PostgreSQL, the API server, and the web UI. The UI is available at `http://localhost:3000`.

### Local development

Start PostgreSQL separately (or use the compose file for just the database), then:

```
bun run dev:server
bun run dev:ui
```

The server runs on port 3001, the UI on port 3000.

## Concepts

**Devbox** -- An ephemeral Docker container where agents run. Each devbox has a sidecar process that exposes filesystem, git, shell exec, and PTY endpoints over HTTP. The server communicates with agents through the sidecar, never by running commands on the host.

**Template** -- A named configuration for devbox creation: base Docker image, resource limits (CPU, memory, disk), environment variables, bootstrap scripts, and network policy. Managed through the UI or the REST API.

**Blueprint** -- A directed graph that defines a workflow. Nodes are either shell commands or AI agent steps. Edges carry conditions (`on_success`, `on_failure`, `on_timeout`) for conditional routing. Four built-in blueprints are included:

- `simple` -- Implement, lint, review. Three steps, no retries.
- `minion` -- Full pipeline: implement, lint (with fix loop), test, review, merge, push, CI poll (with fix loop).
- `writer-reviewer` -- One agent writes, another reviews, with a fix loop.
- `spec-implement-review` -- Spec writing, implementation from spec, review against spec.

**Run** -- A single execution of a blueprint against a repository and branch. Tracks status (`pending`, `provisioning`, `running`, `waiting_ci`, `completed`, `failed`, `cancelled`), transcript events, and patch artifacts.

## Project structure

The repo is a Bun monorepo with three packages:

- `packages/server` -- Express API server. Manages devboxes via the Docker socket, runs blueprints, stores runs and patches in PostgreSQL.
- `packages/sidecar` -- Lightweight HTTP server that runs inside each devbox container. Exposes exec, git, filesystem, and PTY endpoints.
- `packages/ui` -- Next.js web interface. Lists runs, shows live transcripts and diffs, visualizes blueprint DAGs, manages templates and settings.
- `packages/shared` -- TypeScript type definitions shared across packages.

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
