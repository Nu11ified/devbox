# Per-User Provider Auth Design

## Goal

Replace the current shared/scattered credential system with per-user, encrypted provider authentication. Each user independently authenticates with Claude Code and/or Codex via CLI OAuth flows running in ephemeral Docker containers, with credentials encrypted at rest using per-user derived keys.

## Context

This is sub-project 1 of 3 in the auth redesign:
1. **Per-user provider auth** (this spec)
2. SDK configuration surface (future)
3. Devbox security hardening (future)

### Current Problems

- All users share one set of Claude credentials (server-wide `ANTHROPIC_API_KEY` or host `~/.claude/` mounted into containers)
- `UserSettings.anthropicApiKey` is stored **unencrypted** in Postgres
- `AuthProxy` stores tokens in-memory only — lost on server restart
- Credentials injected as plain env vars, visible via `docker inspect`
- No per-user OAuth flow for Claude or Codex

## Design

### 1. Data Model

New `ProviderCredential` table replaces `UserSettings.anthropicApiKey` and the in-memory `AuthProxy`:

```prisma
model ProviderCredential {
  id             String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId         String    @map("user_id")
  provider       String    // "claude" | "codex"
  credentialData Bytes     @map("credential_data")  // encrypted blob
  encryptionIv   String    @map("encryption_iv")    // hex, per-record random IV
  encryptionTag  String    @map("encryption_tag")   // hex, AES-GCM auth tag
  authMethod     String    @map("auth_method")      // "oauth" | "api_key"
  status         String    @default("active")       // "active" | "expired" | "revoked"
  lastUsedAt     DateTime? @map("last_used_at")
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @default(now()) @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id])

  @@unique([userId, provider])
  @@map("provider_credential")
}
```

**`credentialData` contents by auth method:**

- `authMethod: "oauth"` — Serialized credential files:
  - Claude: contents of `~/.claude/` (credentials.json and related files), JSON-serialized as `{ files: { [relativePath]: base64Contents } }`
  - Codex: contents of `~/.codex/auth.json`, JSON-serialized as `{ files: { "auth.json": base64Contents } }`
- `authMethod: "api_key"` — Encrypted API key string

**Credential scoping:** All queries include `where: { userId }`, consistent with the existing project/thread/issue isolation model.

### 2. Per-User Key Derivation

Each user's credentials are encrypted with a unique derived key:

```
masterKey = Buffer.from(process.env.PATCHWORK_ENCRYPTION_KEY, 'hex')  // 32 bytes, required

userKey = HKDF-SHA256(
  ikm:  masterKey,
  salt: SHA256(userId),
  info: "patchwork-provider-credential",
  len:  32 bytes
)
```

Per-record encryption:
- Random 16-byte IV per record
- AES-256-GCM produces ciphertext + 16-byte auth tag
- IV and tag stored alongside ciphertext in the `ProviderCredential` row

Properties:
- Compromising one user's key does not expose other users' credentials
- Master key rotation: re-derive all user keys, re-encrypt all records
- No per-user key storage — deterministically derived from master + userId

`PATCHWORK_ENCRYPTION_KEY` becomes **required**. Server refuses to start without it (random keys cause credential loss on restart).

Changes to `packages/server/src/auth/crypto.ts`:
- Add `async deriveUserKey(masterKey: Buffer, userId: string): Promise<Buffer>` using Node's `crypto.hkdf` (callback-based, wrapped in a Promise). The async form is used because `crypto.hkdfSync` requires Node 21+; the async `crypto.hkdf` is available in Node 16+ and bun.
- Update `encrypt()` to accept a `Buffer` key and return `{ encrypted: Buffer, iv: Buffer, tag: Buffer }` (binary, not hex strings). The `ProviderCredential.credentialData` column is `Bytes` (Prisma maps to PostgreSQL `bytea`), so the encrypted output is stored as raw binary. `encryptionIv` and `encryptionTag` remain hex strings for readability in the DB.
- Update `decrypt()` to accept `Buffer` inputs matching the new `encrypt()` output.
- Existing callers of `encrypt()`/`decrypt()` updated to match new signatures.

### 3. Auth Container Service

New service: `packages/server/src/auth/auth-container.ts`

Manages ephemeral Docker containers for CLI OAuth flows.

**Container lifecycle:**

```
User clicks "Connect Claude" in Settings
  → Server creates auth container
  → WebSocket bridge connects xterm.js (browser) to container PTY
  → CLI runs its OAuth flow (opens browser tab for user to authorize)
  → User authorizes, CLI receives token and writes to disk
  → Server detects credential files appear (polling every 2s)
  → Server reads credential files from container
  → Encrypts with per-user derived key
  → Stores in ProviderCredential table
  → Container is destroyed
```

**Auth container spec:**
- Image: `patchwork-auth:latest` (minimal: Node.js + Claude CLI + Codex CLI)
- Network: enabled (required for OAuth callbacks)
- Security: `CapDrop: ALL`, `no-new-privileges: true`, `PidsLimit: 64`
- Filesystem: tmpfs home directory (nothing persists on host)
- Timeout: 5 minutes auto-destroy (prevents orphaned containers)
- Concurrency: one auth container per user at a time

**Auth completion detection:**
- Poll for credential files inside container every 2 seconds using Docker API (`container.getArchive(path)` — returns 404 if file doesn't exist, tar stream if it does):
  - Claude: `/home/user/.claude/credentials.json`
  - Codex: `/home/user/.codex/auth.json`
- File appears → extract from tar stream in memory → encrypt → store in DB → destroy container
- Timeout (5 min) → destroy container → send `auth.timeout` WebSocket event

**File reading from container:**
- Use `container.getArchive({ path })` from dockerode to read credential files as a tar stream
- Parse the tar stream in memory, extract file contents as Buffers
- No host directory bind-mounts needed for credential capture

**CLI commands run inside container:**
- Claude: `claude login`
- Codex: `codex login`

**Container creation:**
- Auth containers are created directly via dockerode (`docker.createContainer()`), not via `DevboxManager`. Auth containers have different requirements (network enabled, no workspace mounts, shorter timeout) and don't need the full devbox lifecycle.

### 4. Credential Injection into Devboxes

How credentials flow from DB into running thread containers.

**New flow (replaces current env var injection):**

```
Thread launch
  → Query ProviderCredential WHERE userId AND provider
  → No credential found → error: "Provider not configured, set up in Settings"
  → Decrypt credentialData with per-user derived key
  → Based on authMethod:
      "oauth":
        Claude → reconstruct ~/.claude/ directory inside container
        Codex  → write ~/.codex/auth.json inside container
      "api_key":
        Claude → inject ANTHROPIC_API_KEY env var
        Codex  → inject OPENAI_API_KEY env var
  → Update lastUsedAt on credential record
```

**OAuth file injection mechanism:**
- Use `container.putArchive(tarStream, { path: '/home/user' })` from dockerode to write credential files into the devbox container
- Server creates a tar archive in memory from the decrypted credential file map (`{ [relativePath]: Buffer }`)
- Files are written before the CLI process starts, so credentials are available immediately
- Tar archive and decrypted buffers are zeroed after injection

**Auth failure handling (reactive):**
- When a thread's provider returns an auth error, mark the credential `status: "expired"`
- Surface error to user: "Your Claude credentials have expired. Reauthenticate in Settings."
- No proactive validation — auth failures are detected only when they occur

**Security improvements over current approach:**
- OAuth credentials injected as files, not env vars (not visible in `docker inspect`)
- Credentials decrypted in server memory only for injection duration, then discarded
- No credentials linger on any filesystem

### 5. API Endpoints

**New endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/provider/connect/:provider` | Spawn auth container, return WebSocket URL for terminal |
| `DELETE` | `/api/auth/provider/:provider` | Revoke and delete stored credential |
| `GET` | `/api/auth/provider/status` | Status per provider: `{ claude: { connected, authMethod, lastUsedAt }, codex: { ... } }` |
| `POST` | `/api/auth/provider/apikey/:provider` | Store manually-entered API key (encrypted) |

**WebSocket endpoint:**

| Path | Description |
|------|-------------|
| `GET /api/auth/terminal/:provider` | Upgrades to WebSocket, bridges xterm.js to auth container PTY |

**Removed endpoints:**
- `POST /api/auth/tokens` → replaced by connect + apikey endpoints
- `GET /api/auth/tokens` → replaced by provider status
- `DELETE /api/auth/tokens/:provider` → replaced by new delete
- `GET /api/auth/status` → replaced by provider status

All endpoints require user authentication (`requireUser()` middleware). All credential queries scoped by `userId`.

**Reauthentication behavior:** The `connect` and `apikey` endpoints use **upsert** (not insert) on `ProviderCredential`. If a credential already exists for the user+provider pair, it is replaced with the new one and `status` is reset to `"active"`. This handles reauthentication without hitting the unique constraint.

**WebSocket registration:** The auth terminal WebSocket endpoint is registered in `index.ts` using the same pattern as the existing thread WebSocket (`thread-ws.ts`): `server.on("upgrade", ...)` with path matching for `/api/auth/terminal/:provider`.

**Auth terminal WebSocket message protocol:**

| Direction | Type | Payload | When |
|-----------|------|---------|------|
| Server → Client | `auth.ready` | `{ containerId: string }` | Container started, terminal attached |
| Server → Client | `auth.success` | `{ provider: string }` | Credentials captured and stored |
| Server → Client | `auth.timeout` | `{ remainingSeconds: 0 }` | 5-minute timeout reached |
| Server → Client | `auth.error` | `{ message: string }` | Container or capture failure |
| Both | `data` | `{ data: string }` | Terminal I/O (xterm.js ↔ container PTY) |

### 6. Settings UI

Reworked **Provider Connections** section in Settings page.

**Per-provider card (Claude, Codex):**

- **Connected state:** Auth method badge (OAuth / API Key), last used date, "Disconnect" button
- **Disconnected state:** Two options:
  - "Connect with CLI" button → opens terminal modal
  - "Use API Key" → expands inline text input
- **Expired state:** Warning banner, "Reauthenticate" button → opens terminal modal

**Terminal modal:**
- Modal overlay with embedded xterm.js terminal
- WebSocket connection to `/api/auth/terminal/:provider`
- Shows CLI login flow output
- Auto-closes on credential capture success (toast: "Connected successfully")
- Close button to cancel (destroys auth container)
- 5-minute timeout with countdown indicator

**Thread creation error handling:**
- No credentials for selected provider → toast error with "Set up in Settings" link

### 7. Migration & Cleanup

**Removed:**
- `UserSettings.anthropicApiKey` column
- `AuthProxy` class (`packages/server/src/auth/proxy.ts`)
- Old token endpoints in `packages/server/src/api/auth.ts`
- In-memory token Map

**Migration steps:**
1. Add `ProviderCredential` table
2. **Guard:** Migration script must check that `PATCHWORK_ENCRYPTION_KEY` is set before proceeding. If missing, abort with error: "Cannot migrate credentials without PATCHWORK_ENCRYPTION_KEY". This prevents silently writing unencryptable or corrupted data.
3. For each `UserSettings` with non-null `anthropicApiKey`: create `ProviderCredential` with `authMethod: "api_key"`, encrypted with user's derived key
4. Drop `anthropicApiKey` column from `user_settings`
4. Update `threads.ts` credential resolution → use `ProviderCredential`
5. Update `adapter.ts` → reconstruct credential files for OAuth mode

**Unchanged:**
- `crypto.ts` — extended with `deriveUserKey()`, existing functions reused
- GitHub OAuth via better-auth
- Session auth middleware
- Container security settings in devbox manager (inherited by auth containers)

## File Map

| File | Action |
|------|--------|
| `packages/server/prisma/schema.prisma` | Add `ProviderCredential` model, remove `anthropicApiKey` from `UserSettings` |
| `packages/server/src/auth/crypto.ts` | Add `deriveUserKey()` |
| `packages/server/src/auth/auth-container.ts` | New — auth container lifecycle management |
| `packages/server/src/auth/proxy.ts` | Delete |
| `packages/server/src/auth/credential-store.ts` | New — encrypt/decrypt/store/retrieve credentials |
| `packages/server/src/api/auth.ts` | Replace old token endpoints with new provider endpoints |
| `packages/server/src/api/auth-ws.ts` | New — WebSocket terminal bridge for auth containers |
| `packages/server/src/api/threads.ts` | Update credential resolution to use CredentialStore |
| `packages/server/src/providers/claude-code/adapter.ts` | Update credential injection (file-based for OAuth) |
| `packages/server/src/providers/codex/adapter.ts` | Update credential injection |
| `packages/server/src/index.ts` | Require `PATCHWORK_ENCRYPTION_KEY`, remove AuthProxy init |
| `packages/ui/src/components/settings-form.tsx` | Rework provider connections section |
| `packages/ui/src/components/auth-terminal-modal.tsx` | New — xterm.js modal for CLI auth |
| `packages/ui/src/lib/api.ts` | Update auth API methods |
| `docker/Dockerfile.auth` | New — auth container image (CLI tools only) |

## Out of Scope

- SDK configuration surface (sub-project 2)
- Devbox security hardening beyond credential injection (sub-project 3)
- Proactive credential validation / health checks
- Token refresh automation (CLIs handle their own refresh)
- Multi-provider per thread (one provider per thread)
