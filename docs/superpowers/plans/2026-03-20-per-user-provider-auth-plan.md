# Per-User Provider Auth Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace shared/in-memory credential system with per-user, encrypted provider authentication using DB-backed credential storage and ephemeral Docker containers for CLI OAuth flows.

**Architecture:** New `ProviderCredential` table with AES-256-GCM encryption using HKDF-derived per-user keys. Auth container service spawns ephemeral Docker containers for CLI OAuth, capturing credentials via Docker API tar streams. Existing `AuthProxy` in-memory class and `UserSettings.anthropicApiKey` are replaced entirely.

**Tech Stack:** Node.js crypto (HKDF, AES-256-GCM), Prisma/PostgreSQL, dockerode, xterm.js, WebSocket, Express

**Spec:** `docs/superpowers/specs/2026-03-20-per-user-provider-auth-design.md`

---

### Task 1: Add `deriveUserKey()` to crypto module

**Files:**
- Modify: `packages/server/src/auth/crypto.ts`
- Create: `packages/server/src/auth/__tests__/crypto.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/server/src/auth/__tests__/crypto.test.ts
import { describe, it, expect } from "bun:test";
import { deriveUserKey, encrypt, decrypt } from "../crypto.js";

describe("deriveUserKey", () => {
  const masterKey = Buffer.from("a".repeat(64), "hex"); // 32 bytes

  it("derives a 32-byte key", async () => {
    const key = await deriveUserKey(masterKey, "user-123");
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
  });

  it("derives different keys for different users", async () => {
    const key1 = await deriveUserKey(masterKey, "user-1");
    const key2 = await deriveUserKey(masterKey, "user-2");
    expect(key1.equals(key2)).toBe(false);
  });

  it("derives the same key for the same user (deterministic)", async () => {
    const key1 = await deriveUserKey(masterKey, "user-1");
    const key2 = await deriveUserKey(masterKey, "user-1");
    expect(key1.equals(key2)).toBe(true);
  });

  it("derived key works with encrypt/decrypt", async () => {
    const key = await deriveUserKey(masterKey, "user-1");
    const data = encrypt("secret-api-key", key);
    const result = decrypt(data, key);
    expect(result).toBe("secret-api-key");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /data/github/devbox && bun test packages/server/src/auth/__tests__/crypto.test.ts`
Expected: FAIL — `deriveUserKey` is not exported / not defined

- [ ] **Step 3: Implement `deriveUserKey`**

In `packages/server/src/auth/crypto.ts`, add after the existing imports:

```typescript
import { createCipheriv, createDecipheriv, randomBytes, createHash, hkdf } from "node:crypto";

// ... existing ALGORITHM, EncryptedData, encrypt, decrypt stay unchanged ...

/**
 * Derive a per-user encryption key from the master key using HKDF-SHA256.
 * Each user gets a unique key so compromising one doesn't expose others.
 */
export async function deriveUserKey(masterKey: Buffer, userId: string): Promise<Buffer> {
  const salt = createHash("sha256").update(userId).digest();
  return new Promise<Buffer>((resolve, reject) => {
    hkdf("sha256", masterKey, salt, "patchwork-provider-credential", 32, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(Buffer.from(derivedKey));
    });
  });
}
```

Note: Uses the async `crypto.hkdf` callback API (available in Node 16+ and bun), not `hkdfSync` which requires Node 21+.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /data/github/devbox && bun test packages/server/src/auth/__tests__/crypto.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth/crypto.ts packages/server/src/auth/__tests__/crypto.test.ts
git commit -m "feat(auth): add HKDF-based per-user key derivation to crypto module"
```

---

### Task 2: Add `ProviderCredential` model to Prisma schema

**Files:**
- Modify: `packages/server/prisma/schema.prisma`

- [ ] **Step 1: Add `ProviderCredential` model**

Add after the `UserSettings` model (around line 300):

```prisma
model ProviderCredential {
  id             String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId         String    @map("user_id")
  provider       String    // "claude" | "codex"
  credentialData Bytes     @map("credential_data")  // AES-256-GCM encrypted blob
  encryptionIv   String    @map("encryption_iv")    // hex, per-record random IV
  encryptionTag  String    @map("encryption_tag")   // hex, AES-256-GCM auth tag
  authMethod     String    @map("auth_method")      // "oauth" | "api_key"
  status         String    @default("active")       // "active" | "expired" | "revoked"
  lastUsedAt     DateTime? @map("last_used_at") @db.Timestamptz
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt      DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  user User @relation(fields: [userId], references: [id])

  @@unique([userId, provider])
  @@map("provider_credential")
}
```

Add `providerCredentials ProviderCredential[]` to the `User` model's relation fields (alongside the existing `sessions`, `accounts`, etc.).

- [ ] **Step 2: Push schema to database**

Run: `cd /data/github/devbox/packages/server && bunx prisma db push`
Expected: Schema pushed, `provider_credential` table created

- [ ] **Step 3: Generate Prisma client**

Run: `cd /data/github/devbox/packages/server && bunx prisma generate`
Expected: Prisma Client generated successfully

- [ ] **Step 4: Verify the model exists in generated client**

Run: `cd /data/github/devbox && bun -e "import prisma from './packages/server/src/db/prisma.js'; console.log(typeof prisma.providerCredential)"`
Expected: `object`

- [ ] **Step 5: Commit**

```bash
git add packages/server/prisma/schema.prisma
git commit -m "feat(auth): add ProviderCredential model for per-user encrypted credentials"
```

---

### Task 3: Create Credential Store service

**Files:**
- Create: `packages/server/src/auth/credential-store.ts`
- Create: `packages/server/src/auth/__tests__/credential-store.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/server/src/auth/__tests__/credential-store.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { CredentialStore } from "../credential-store.js";

const TEST_MASTER_KEY = Buffer.from("a".repeat(64), "hex");

describe("CredentialStore", () => {
  let store: CredentialStore;

  beforeEach(() => {
    store = new CredentialStore(TEST_MASTER_KEY);
  });

  describe("storeApiKey", () => {
    it("stores and retrieves an API key", async () => {
      await store.storeApiKey("user-1", "claude", "sk-ant-test-key");
      const cred = await store.getCredential("user-1", "claude");
      expect(cred).not.toBeNull();
      expect(cred!.provider).toBe("claude");
      expect(cred!.authMethod).toBe("api_key");
      expect(cred!.status).toBe("active");
    });
  });

  describe("storeOAuthCredentials", () => {
    it("stores and retrieves OAuth file map", async () => {
      const files = {
        "credentials.json": Buffer.from('{"token":"abc"}'),
        ".credentials": Buffer.from("refresh-data"),
      };
      await store.storeOAuthCredentials("user-1", "claude", files);
      const cred = await store.getCredential("user-1", "claude");
      expect(cred).not.toBeNull();
      expect(cred!.authMethod).toBe("oauth");
    });
  });

  describe("decryptCredential", () => {
    it("decrypts API key credential", async () => {
      await store.storeApiKey("user-1", "claude", "sk-ant-test-key");
      const decrypted = await store.decryptCredential("user-1", "claude");
      expect(decrypted).not.toBeNull();
      expect(decrypted!.type).toBe("api_key");
      if (decrypted!.type === "api_key") {
        expect(decrypted!.apiKey).toBe("sk-ant-test-key");
      }
    });

    it("decrypts OAuth credential to file map", async () => {
      const files = {
        "credentials.json": Buffer.from('{"token":"abc"}'),
      };
      await store.storeOAuthCredentials("user-1", "claude", files);
      const decrypted = await store.decryptCredential("user-1", "claude");
      expect(decrypted).not.toBeNull();
      expect(decrypted!.type).toBe("oauth");
      if (decrypted!.type === "oauth") {
        expect(decrypted!.files["credentials.json"]).toBeDefined();
      }
    });
  });

  describe("getProviderStatus", () => {
    it("returns status for all providers", async () => {
      await store.storeApiKey("user-1", "claude", "key");
      const status = await store.getProviderStatus("user-1");
      expect(status.claude.connected).toBe(true);
      expect(status.claude.authMethod).toBe("api_key");
      expect(status.codex.connected).toBe(false);
    });
  });

  describe("revokeCredential", () => {
    it("deletes the credential", async () => {
      await store.storeApiKey("user-1", "claude", "key");
      await store.revokeCredential("user-1", "claude");
      const cred = await store.getCredential("user-1", "claude");
      expect(cred).toBeNull();
    });
  });

  describe("markExpired", () => {
    it("sets credential status to expired", async () => {
      await store.storeApiKey("user-1", "claude", "key");
      await store.markExpired("user-1", "claude");
      const cred = await store.getCredential("user-1", "claude");
      expect(cred!.status).toBe("expired");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /data/github/devbox && bun test packages/server/src/auth/__tests__/credential-store.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement CredentialStore**

```typescript
// packages/server/src/auth/credential-store.ts
import prisma from "../db/prisma.js";
import { encrypt, decrypt, type EncryptedData } from "./crypto.js";
import { deriveUserKey } from "./crypto.js";

export type DecryptedCredential =
  | { type: "api_key"; apiKey: string }
  | { type: "oauth"; files: Record<string, Buffer> };

export interface ProviderStatus {
  connected: boolean;
  authMethod?: string;
  lastUsedAt?: Date | null;
  status?: string;
}

export class CredentialStore {
  constructor(private masterKey: Buffer) {}

  /** Store a manually-entered API key (encrypted). */
  async storeApiKey(userId: string, provider: string, apiKey: string): Promise<void> {
    const userKey = await deriveUserKey(this.masterKey, userId);
    const { encrypted, iv, tag } = encrypt(apiKey, userKey);

    await prisma.providerCredential.upsert({
      where: { userId_provider: { userId, provider } },
      create: {
        userId,
        provider,
        credentialData: Buffer.from(encrypted, "hex"),
        encryptionIv: iv,
        encryptionTag: tag,
        authMethod: "api_key",
        status: "active",
      },
      update: {
        credentialData: Buffer.from(encrypted, "hex"),
        encryptionIv: iv,
        encryptionTag: tag,
        authMethod: "api_key",
        status: "active",
      },
    });
  }

  /** Store OAuth credential files (encrypted). */
  async storeOAuthCredentials(
    userId: string,
    provider: string,
    files: Record<string, Buffer>,
  ): Promise<void> {
    const userKey = await deriveUserKey(this.masterKey, userId);

    // Serialize file map: { [path]: base64 }
    const fileMap: Record<string, string> = {};
    for (const [path, content] of Object.entries(files)) {
      fileMap[path] = content.toString("base64");
    }
    const plaintext = JSON.stringify({ files: fileMap });
    const { encrypted, iv, tag } = encrypt(plaintext, userKey);

    await prisma.providerCredential.upsert({
      where: { userId_provider: { userId, provider } },
      create: {
        userId,
        provider,
        credentialData: Buffer.from(encrypted, "hex"),
        encryptionIv: iv,
        encryptionTag: tag,
        authMethod: "oauth",
        status: "active",
      },
      update: {
        credentialData: Buffer.from(encrypted, "hex"),
        encryptionIv: iv,
        encryptionTag: tag,
        authMethod: "oauth",
        status: "active",
      },
    });
  }

  /** Retrieve raw credential record (for status checks). */
  async getCredential(userId: string, provider: string) {
    return prisma.providerCredential.findUnique({
      where: { userId_provider: { userId, provider } },
    });
  }

  /** Decrypt and return credential for injection into a container. */
  async decryptCredential(
    userId: string,
    provider: string,
  ): Promise<DecryptedCredential | null> {
    const cred = await this.getCredential(userId, provider);
    if (!cred || cred.status !== "active") return null;

    const userKey = await deriveUserKey(this.masterKey, userId);
    const encData: EncryptedData = {
      encrypted: Buffer.from(cred.credentialData).toString("hex"),
      iv: cred.encryptionIv,
      tag: cred.encryptionTag,
    };
    const plaintext = decrypt(encData, userKey);

    // Update lastUsedAt (fire-and-forget)
    prisma.providerCredential.update({
      where: { id: cred.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => {});

    if (cred.authMethod === "api_key") {
      return { type: "api_key", apiKey: plaintext };
    }

    // OAuth: parse file map
    const parsed = JSON.parse(plaintext) as { files: Record<string, string> };
    const files: Record<string, Buffer> = {};
    for (const [path, b64] of Object.entries(parsed.files)) {
      files[path] = Buffer.from(b64, "base64");
    }
    return { type: "oauth", files };
  }

  /** Get connection status for all providers for a user. */
  async getProviderStatus(
    userId: string,
  ): Promise<Record<string, ProviderStatus>> {
    const creds = await prisma.providerCredential.findMany({
      where: { userId },
    });

    const status: Record<string, ProviderStatus> = {
      claude: { connected: false },
      codex: { connected: false },
    };

    for (const cred of creds) {
      status[cred.provider] = {
        connected: cred.status === "active",
        authMethod: cred.authMethod,
        lastUsedAt: cred.lastUsedAt,
        status: cred.status,
      };
    }

    return status;
  }

  /** Delete a credential (disconnect provider). */
  async revokeCredential(userId: string, provider: string): Promise<void> {
    await prisma.providerCredential.deleteMany({
      where: { userId, provider },
    });
  }

  /** Mark a credential as expired (auth failure detected). */
  async markExpired(userId: string, provider: string): Promise<void> {
    await prisma.providerCredential.updateMany({
      where: { userId, provider },
      data: { status: "expired" },
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /data/github/devbox && bun test packages/server/src/auth/__tests__/credential-store.test.ts`
Expected: PASS (all tests). Note: requires a running Postgres with the schema pushed from Task 2.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth/credential-store.ts packages/server/src/auth/__tests__/credential-store.test.ts
git commit -m "feat(auth): add CredentialStore for per-user encrypted credential management"
```

---

### Task 4: Create Auth Container Service

**Files:**
- Create: `packages/server/src/auth/auth-container.ts`
- Create: `packages/server/src/auth/__tests__/auth-container.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/server/src/auth/__tests__/auth-container.test.ts
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { AuthContainerService, type AuthContainerConfig } from "../auth-container.js";

// Mock dockerode — these tests verify lifecycle logic, not actual Docker
const mockContainer = {
  id: "test-container-id",
  start: mock(() => Promise.resolve()),
  stop: mock(() => Promise.resolve()),
  remove: mock(() => Promise.resolve()),
  resize: mock(() => Promise.resolve()),
  attach: mock(() => Promise.resolve({ on: mock(), pipe: mock() })),
  getArchive: mock(() => Promise.reject({ statusCode: 404 })),
};

describe("AuthContainerService", () => {
  it("exports the AuthContainerService class", () => {
    expect(AuthContainerService).toBeDefined();
  });

  it("constructor accepts config", () => {
    const config: AuthContainerConfig = {
      image: "patchwork-auth:latest",
      timeoutMs: 5 * 60 * 1000,
    };
    const service = new AuthContainerService(config);
    expect(service).toBeDefined();
  });

  it("rejects concurrent auth containers for same user", async () => {
    const config: AuthContainerConfig = {
      image: "patchwork-auth:latest",
      timeoutMs: 5 * 60 * 1000,
    };
    const service = new AuthContainerService(config);
    // Mark a container as active for this user
    service._setActiveContainer("user-1", { containerId: "existing", timer: null as any });
    expect(service.hasActiveContainer("user-1")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /data/github/devbox && bun test packages/server/src/auth/__tests__/auth-container.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement AuthContainerService**

```typescript
// packages/server/src/auth/auth-container.ts
import Docker from "dockerode";
import { Readable, PassThrough } from "node:stream";
import tar from "tar-stream";

export interface AuthContainerConfig {
  image: string;
  timeoutMs: number;
}

interface ActiveContainer {
  containerId: string;
  timer: ReturnType<typeof setTimeout> | null;
}

const POLL_INTERVAL_MS = 2000;

// Poll directories (not individual files) to capture all credential files
const CREDENTIAL_PATHS: Record<string, string[]> = {
  claude: ["/home/user/.claude/"],
  codex: ["/home/user/.codex/"],
};

// Sentinel files that confirm auth completed
const CREDENTIAL_SENTINELS: Record<string, string> = {
  claude: "credentials.json",
  codex: "auth.json",
};

const CLI_COMMANDS: Record<string, string[]> = {
  claude: ["claude", "login"],
  codex: ["codex", "login"],
};

export class AuthContainerService {
  private docker: Docker;
  private config: AuthContainerConfig;
  private activeContainers = new Map<string, ActiveContainer>();

  constructor(config: AuthContainerConfig, docker?: Docker) {
    this.config = config;
    this.docker = docker ?? new Docker({ socketPath: "/var/run/docker.sock" });
  }

  hasActiveContainer(userId: string): boolean {
    return this.activeContainers.has(userId);
  }

  /** Test helper — set active container entry. */
  _setActiveContainer(userId: string, entry: ActiveContainer): void {
    this.activeContainers.set(userId, entry);
  }

  /**
   * Spawn an ephemeral auth container for the given provider's CLI login.
   * Returns the container ID and a cleanup function.
   */
  async spawnAuthContainer(
    userId: string,
    provider: string,
  ): Promise<{
    containerId: string;
    cleanup: () => Promise<void>;
  }> {
    if (this.activeContainers.has(userId)) {
      throw new Error("Auth container already active for this user");
    }

    const cliCmd = CLI_COMMANDS[provider];
    if (!cliCmd) throw new Error(`Unknown provider: ${provider}`);

    const container = await this.docker.createContainer({
      Image: this.config.image,
      Cmd: cliCmd,
      Tty: true,
      OpenStdin: true,
      HostConfig: {
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges:true"],
        PidsLimit: 64,
        Tmpfs: { "/home/user": "rw,noexec,nosuid,size=64m" },
      },
    });

    const containerId = container.id;

    const cleanup = async () => {
      const entry = this.activeContainers.get(userId);
      if (entry?.timer) clearTimeout(entry.timer);
      this.activeContainers.delete(userId);
      try {
        await container.stop({ t: 2 });
      } catch {}
      try {
        await container.remove({ force: true });
      } catch {}
    };

    // Set up auto-destroy timeout
    const timer = setTimeout(async () => {
      await cleanup();
    }, this.config.timeoutMs);

    this.activeContainers.set(userId, { containerId, timer });

    await container.start();

    return { containerId, cleanup };
  }

  /**
   * Poll for credential files inside the container.
   * Returns the file contents once found, or null on timeout.
   */
  async pollForCredentials(
    containerId: string,
    provider: string,
    signal: AbortSignal,
  ): Promise<Record<string, Buffer> | null> {
    const paths = CREDENTIAL_PATHS[provider];
    if (!paths) return null;

    const container = this.docker.getContainer(containerId);

    while (!signal.aborted) {
      const sentinel = CREDENTIAL_SENTINELS[provider];
      for (const dirPath of paths) {
        try {
          const archiveStream = await container.getArchive({ path: dirPath });
          const files = await this.extractTarStream(archiveStream);
          // Only return once the sentinel file is present (auth completed)
          if (sentinel && files[sentinel]) {
            return files;
          }
        } catch (err: any) {
          // 404 = directory doesn't exist yet, keep polling
          if (err.statusCode !== 404) {
            console.error(`[auth-container] Error checking ${dirPath}:`, err.message);
          }
        }
      }

      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, POLL_INTERVAL_MS);
        signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
      });
    }

    return null;
  }

  /** Extract files from a Docker getArchive tar stream. */
  private async extractTarStream(stream: NodeJS.ReadableStream): Promise<Record<string, Buffer>> {
    return new Promise((resolve, reject) => {
      const extract = tar.extract();
      const files: Record<string, Buffer> = {};

      extract.on("entry", (header, entryStream, next) => {
        const chunks: Buffer[] = [];
        entryStream.on("data", (chunk: Buffer) => chunks.push(chunk));
        entryStream.on("end", () => {
          if (header.type === "file") {
            // Preserve relative path from tar (Docker getArchive includes
            // a top-level directory name — strip just that prefix)
            const parts = header.name.split("/");
            const relativePath = parts.length > 1 ? parts.slice(1).join("/") : header.name;
            if (relativePath) files[relativePath] = Buffer.concat(chunks);
          }
          next();
        });
        entryStream.resume();
      });

      extract.on("finish", () => resolve(files));
      extract.on("error", reject);

      (stream as any).pipe(extract);
    });
  }

  /** Destroy a user's active auth container. */
  async destroyContainer(userId: string): Promise<void> {
    const entry = this.activeContainers.get(userId);
    if (!entry) return;

    if (entry.timer) clearTimeout(entry.timer);
    this.activeContainers.delete(userId);

    try {
      const container = this.docker.getContainer(entry.containerId);
      await container.stop({ t: 2 });
      await container.remove({ force: true });
    } catch {}
  }
}
```

Note: This requires the `tar-stream` npm package. Install it:
```bash
cd /data/github/devbox/packages/server && bun add tar-stream && bun add -D @types/tar-stream
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /data/github/devbox && bun test packages/server/src/auth/__tests__/auth-container.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth/auth-container.ts packages/server/src/auth/__tests__/auth-container.test.ts packages/server/package.json bun.lock
git commit -m "feat(auth): add AuthContainerService for ephemeral CLI OAuth containers"
```

---

### Task 5: Replace auth API endpoints

**Files:**
- Modify: `packages/server/src/api/auth.ts`
- Create: `packages/server/src/api/__tests__/auth-api.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/server/src/api/__tests__/auth-api.test.ts
import { describe, it, expect } from "bun:test";
import express from "express";
import request from "supertest";
import { authRouter } from "../auth.js";

// Note: authRouter now takes CredentialStore + AuthContainerService
// These tests verify route structure and validation
describe("auth API routes", () => {
  it("exports authRouter function", () => {
    expect(typeof authRouter).toBe("function");
  });

  // The detailed endpoint tests will be integration tests
  // that run against a real DB and credential store
});
```

- [ ] **Step 2: Rewrite `auth.ts` with new endpoints**

Replace `packages/server/src/api/auth.ts` entirely:

```typescript
// packages/server/src/api/auth.ts
import { Router } from "express";
import type { CredentialStore } from "../auth/credential-store.js";
import type { AuthContainerService } from "../auth/auth-container.js";
import { requireUser, getUserId } from "../auth/require-user.js";

const VALID_PROVIDERS = new Set(["claude", "codex"]);

export function authRouter(
  credentialStore: CredentialStore,
  authContainerService: AuthContainerService,
): Router {
  const router = Router();

  // Strip surrounding quotes and trim whitespace from a value
  function clean(s: string | undefined): string {
    if (!s) return "";
    let v = s.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    return v;
  }

  // POST /api/auth/login — validate credentials against env vars
  router.post("/login", (req, res) => {
    const serverUsername = clean(process.env.PATCHWORK_USERNAME);
    const serverPassword = clean(process.env.PATCHWORK_PASSWORD);
    if (!serverUsername || !serverPassword) {
      res.json({ authenticated: true });
      return;
    }
    const username = clean(req.body?.username);
    const password = clean(req.body?.password);
    if (username === serverUsername && password === serverPassword) {
      res.json({ authenticated: true });
      return;
    }
    res.status(401).json({ error: "Invalid credentials" });
  });

  // GET /api/auth/debug — show auth config (no secrets)
  router.get("/debug", (_req, res) => {
    const u = process.env.PATCHWORK_USERNAME;
    const p = process.env.PATCHWORK_PASSWORD;
    res.json({
      authEnabled: !!(u && p),
      usernameLength: u?.length ?? 0,
      passwordLength: p?.length ?? 0,
      serverVersion: "2025-03-05-v2",
    });
  });

  // GET /api/auth/provider/status — connection status per provider
  router.get("/provider/status", requireUser(), async (req, res) => {
    try {
      const userId = getUserId(req);
      const status = await credentialStore.getProviderStatus(userId);
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Note: No REST endpoint for spawning auth containers.
  // Container creation happens when the WebSocket connects (auth-ws.ts).
  // This avoids a race condition between REST spawn + WS attach.

  // POST /api/auth/provider/apikey/:provider — store API key
  router.post("/provider/apikey/:provider", requireUser(), async (req, res) => {
    try {
      const userId = getUserId(req);
      const provider = req.params.provider as string;
      const { apiKey } = req.body;

      if (!VALID_PROVIDERS.has(provider)) {
        return res.status(400).json({ error: `Invalid provider: ${provider}` });
      }
      if (!apiKey || typeof apiKey !== "string") {
        return res.status(400).json({ error: "apiKey is required" });
      }

      await credentialStore.storeApiKey(userId, provider, apiKey);
      res.status(201).json({ provider, stored: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/auth/provider/:provider — revoke credential
  router.delete("/provider/:provider", requireUser(), async (req, res) => {
    try {
      const userId = getUserId(req);
      const provider = req.params.provider as string;

      if (!VALID_PROVIDERS.has(provider)) {
        return res.status(400).json({ error: `Invalid provider: ${provider}` });
      }

      // Also destroy any active auth container
      await authContainerService.destroyContainer(userId);
      await credentialStore.revokeCredential(userId, provider);
      res.json({ provider, removed: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd /data/github/devbox && bun test packages/server/src/api/__tests__/auth-api.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/api/auth.ts packages/server/src/api/__tests__/auth-api.test.ts
git commit -m "feat(auth): replace token endpoints with provider credential endpoints"
```

---

### Task 6: Create Auth Terminal WebSocket bridge

**Files:**
- Create: `packages/server/src/api/auth-ws.ts`

- [ ] **Step 1: Write the WebSocket bridge**

```typescript
// packages/server/src/api/auth-ws.ts
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import Docker from "dockerode";
import type { CredentialStore } from "../auth/credential-store.js";
import type { AuthContainerService } from "../auth/auth-container.js";
import { consumeWsTicket } from "../auth/ws-tickets.js";

const VALID_PROVIDERS = new Set(["claude", "codex"]);

export function setupAuthWebSocket(
  credentialStore: CredentialStore,
  authContainerService: AuthContainerService,
) {
  const wss = new WebSocketServer({ noServer: true });
  const docker = new Docker({ socketPath: "/var/run/docker.sock" });

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage, userId: string, provider: string) => {
    let cleanup: (() => Promise<void>) | null = null;

    try {
      // Spawn auth container
      const result = await authContainerService.spawnAuthContainer(userId, provider);
      cleanup = result.cleanup;
      const containerId = result.containerId;

      ws.send(JSON.stringify({ type: "auth.ready", containerId }));

      // Attach to container PTY
      const container = docker.getContainer(containerId);
      const attachStream = await container.attach({
        stream: true,
        stdin: true,
        stdout: true,
        stderr: true,
        hijack: true,
      });

      // Container stdout → WebSocket
      attachStream.on("data", (chunk: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "data", data: chunk.toString() }));
        }
      });

      // WebSocket → Container stdin
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "data" && msg.data) {
            attachStream.write(msg.data);
          }
        } catch {}
      });

      // Poll for credential files
      const abortController = new AbortController();

      const credentialFiles = await authContainerService.pollForCredentials(
        containerId,
        provider,
        abortController.signal,
      );

      if (credentialFiles && Object.keys(credentialFiles).length > 0) {
        // Store credentials
        await credentialStore.storeOAuthCredentials(userId, provider, credentialFiles);
        ws.send(JSON.stringify({ type: "auth.success", provider }));
      } else {
        ws.send(JSON.stringify({ type: "auth.timeout", remainingSeconds: 0 }));
      }

      // Cleanup
      await cleanup();
      cleanup = null;
      ws.close();
    } catch (err: any) {
      console.error(`[auth-ws] Error for user ${userId}:`, err.message);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "auth.error", message: err.message }));
      }
      if (cleanup) await cleanup();
      ws.close();
    }
  });

  return {
    wss,
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
      // Parse URL: /api/auth/terminal/:provider?ticket=xxx
      const url = new URL(req.url || "", `http://${req.headers.host}`);
      const match = url.pathname.match(/^\/api\/auth\/terminal\/(\w+)$/);
      if (!match) {
        socket.destroy();
        return;
      }

      const provider = match[1];
      if (!VALID_PROVIDERS.has(provider)) {
        socket.destroy();
        return;
      }

      // Authenticate via ticket
      const ticket = url.searchParams.get("ticket");
      if (!ticket) {
        socket.destroy();
        return;
      }

      const userId = consumeWsTicket(ticket);
      if (!userId) {
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req, userId, provider);
      });
    },
  };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /data/github/devbox && bunx tsc --noEmit packages/server/src/api/auth-ws.ts`
(Or just verify no red squiggles if using an IDE.)

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/api/auth-ws.ts
git commit -m "feat(auth): add WebSocket bridge for auth container terminal"
```

---

### Task 7: Update thread credential resolution

**Files:**
- Modify: `packages/server/src/api/threads.ts`
- Modify: `packages/server/src/api/teams.ts`

- [ ] **Step 0: Add `oauthFiles` to `SessionStartInput` type**

In `packages/server/src/providers/adapter.ts`, add a new field to `SessionStartInput`:

```typescript
export interface SessionStartInput {
  threadId: ThreadId;
  provider: ProviderKind;
  model?: string;
  runtimeMode: RuntimeMode;
  workspacePath: string;
  useSubscription: boolean;
  apiKey?: string;
  githubToken?: string;
  resumeCursor?: unknown;
  repo?: string;
  branch?: string;
  userId?: string;
  projectId?: string;
  /** OAuth credential files to inject (e.g. ~/.claude/ contents) */
  oauthFiles?: Record<string, Buffer>;
}
```

- [ ] **Step 1: Update `threads.ts` to use CredentialStore**

In `packages/server/src/api/threads.ts`:

1. Change the import from `AuthProxy` to `CredentialStore`:
```typescript
import type { CredentialStore } from "../auth/credential-store.js";
```

2. Change the function signature:
```typescript
export function threadsRouter(providerService: ProviderService, credentialStore?: CredentialStore): Router {
```

3. Replace the credential resolution block (lines ~82-97) with:
```typescript
      // Resolve credentials from CredentialStore
      let oauthFiles: Record<string, Buffer> | undefined;
      if (credentialStore && userId) {
        const providerName = provider === "claudeCode" ? "claude" : "codex";
        const decrypted = await credentialStore.decryptCredential(userId, providerName);
        if (decrypted) {
          if (decrypted.type === "api_key") {
            apiKey = decrypted.apiKey;
          } else {
            // OAuth credentials — pass files to adapter via SessionStartInput
            oauthFiles = decrypted.files;
          }
        }
      }

      if (userId) {
        const settings = await prisma.userSettings.findUnique({ where: { userId } });
        if (!useSubscription && provider === "claudeCode" && settings?.claudeSubscription) {
          subscription = true;
        }
        // Fall back to DB key only if no credential found (transitional)
        if (!apiKey && !oauthFiles) {
          apiKey = settings?.anthropicApiKey ?? undefined;
        }

        const account = await prisma.account.findFirst({
          where: { userId, providerId: "github" },
        });
        githubToken = account?.accessToken ?? undefined;
      }
```

4. Pass `oauthFiles` in the session start call (find where `apiKey` is passed to `providerService.startSession()` and add `oauthFiles`):
```typescript
      // In the startSession call, add oauthFiles:
      const result = await Effect.runPromise(
        providerService.startSession({
          // ... existing fields ...
          apiKey,
          oauthFiles,
          // ...
        })
      );
```

- [ ] **Step 2: Apply the same changes to `teams.ts`**

In `packages/server/src/api/teams.ts`, make the matching changes:
1. Import `CredentialStore` instead of `AuthProxy`
2. Change `teamsRouter(providerService: ProviderService, credentialStore?: CredentialStore)`
3. Replace the credential resolution block (~lines 125-140) with the same pattern

- [ ] **Step 3: Verify no TypeScript errors**

Run: `cd /data/github/devbox && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/api/threads.ts packages/server/src/api/teams.ts
git commit -m "feat(auth): update thread/team credential resolution to use CredentialStore"
```

---

### Task 7.5: Update adapters for OAuth file injection

**Files:**
- Modify: `packages/server/src/providers/claude-code/adapter.ts`
- Modify: `packages/server/src/providers/codex/adapter.ts` (if it exists as separate adapter)

This is the critical security improvement: OAuth credentials are injected as files (not env vars), so they're not visible via `docker inspect`.

- [ ] **Step 1: Update Claude Code adapter to handle `oauthFiles`**

In `packages/server/src/providers/claude-code/adapter.ts`, find the `startSession` method where `SessionState` is created (around line 42-59). Add `oauthFiles` to the session state:

```typescript
interface SessionState {
  session: ProviderSession & {
    apiKey?: string;
    useSubscription?: boolean;
    githubToken?: string;
    workspacePath?: string;
    userId?: string;
    projectId?: string;
    teamId?: string;
    oauthFiles?: Record<string, Buffer>; // NEW
  };
  // ... rest unchanged
}
```

In the `startSession` method, pass `oauthFiles` from `SessionStartInput` into the session state.

Then in the `executeTurn` method (around line 330-350 where env vars are set), add OAuth file injection BEFORE the query call:

```typescript
    // OAuth credential injection: write files to workspace instead of env var
    if (state.session.oauthFiles && !state.session.apiKey) {
      const claudeDir = join(cwd, ".claude");
      if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });

      for (const [relativePath, content] of Object.entries(state.session.oauthFiles)) {
        const filePath = join(claudeDir, relativePath);
        const dir = filePath.substring(0, filePath.lastIndexOf("/"));
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(filePath, content, { mode: 0o600 });
      }

      // Tell Claude CLI to use the workspace .claude/ dir
      env.CLAUDE_CONFIG_DIR = claudeDir;

      // Zero the in-memory buffers after writing
      for (const buf of Object.values(state.session.oauthFiles)) {
        buf.fill(0);
      }
      delete state.session.oauthFiles;
    } else if (state.session.apiKey && !state.session.useSubscription) {
      env.ANTHROPIC_API_KEY = state.session.apiKey;
    } else {
      delete env.ANTHROPIC_API_KEY;
    }
```

This replaces the current block at lines 343-347:
```typescript
    // Current code to replace:
    if (state.session.apiKey && !state.session.useSubscription) {
      env.ANTHROPIC_API_KEY = state.session.apiKey;
    } else {
      delete env.ANTHROPIC_API_KEY;
    }
```

- [ ] **Step 2: Update Codex adapter similarly**

In the Codex adapter, apply the same pattern but for `~/.codex/` directory and `OPENAI_API_KEY`.

- [ ] **Step 3: Verify no TypeScript errors**

Run: `cd /data/github/devbox && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/providers/claude-code/adapter.ts packages/server/src/providers/codex/adapter.ts packages/server/src/providers/adapter.ts
git commit -m "feat(auth): inject OAuth credentials as files, not env vars"
```

---

### Task 8: Update server startup (`index.ts`)

**Files:**
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Update imports and initialization**

In `packages/server/src/index.ts`:

1. Replace imports:
```typescript
// Remove:
import { AuthProxy } from "./auth/proxy.js";

// Add:
import { CredentialStore } from "./auth/credential-store.js";
import { AuthContainerService } from "./auth/auth-container.js";
import { setupAuthWebSocket } from "./api/auth-ws.js";
```

2. Replace the `authProxy` initialization (lines ~43-45):
```typescript
  // Credential encryption — PATCHWORK_ENCRYPTION_KEY is required
  const encKeyHex = process.env.PATCHWORK_ENCRYPTION_KEY;
  if (!encKeyHex) {
    console.warn("[server] PATCHWORK_ENCRYPTION_KEY not set — using random key (credentials will not persist across restarts)");
  }
  const encKey = encKeyHex ? Buffer.from(encKeyHex, "hex") : randomBytes(32);
  const credentialStore = new CredentialStore(encKey);

  const authContainerService = new AuthContainerService({
    image: process.env.AUTH_CONTAINER_IMAGE || "patchwork-auth:latest",
    timeoutMs: 5 * 60 * 1000,
  });
```

3. Update router registrations:
```typescript
  app.use("/api/auth", authRouter(credentialStore, authContainerService));
  // ...
  app.use("/api/threads", threadsRouter(providerService, credentialStore));
  // ...
  app.use("/api/projects/:projectId/teams", teamsRouter(providerService, credentialStore));
```

4. In the `startServer()` function where the `server.on("upgrade", ...)` is set up, add the auth WebSocket handler:
```typescript
  const authWs = setupAuthWebSocket(credentialStore, authContainerService);

  server.on("upgrade", (req, socket, head) => {
    const url = req.url || "";
    if (url.startsWith("/api/auth/terminal/")) {
      authWs.handleUpgrade(req, socket, head);
    } else if (url.startsWith("/api/threads/")) {
      // existing thread WebSocket handling
      handleThreadUpgrade(req, socket, head);
    } else if (url.startsWith("/api/projects/") && url.includes("/events")) {
      handleProjectEventsUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /data/github/devbox && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat(auth): wire CredentialStore and AuthContainerService into server startup"
```

---

### Task 9: Create Auth Terminal Modal UI component

**Files:**
- Create: `packages/ui/src/components/auth-terminal-modal.tsx`

- [ ] **Step 1: Create the modal component**

```tsx
// packages/ui/src/components/auth-terminal-modal.tsx
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Terminal as TerminalIcon, Loader2 } from "lucide-react";

interface AuthTerminalModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: "claude" | "codex";
  onSuccess: () => void;
}

export function AuthTerminalModal({
  open,
  onOpenChange,
  provider,
  onSuccess,
}: AuthTerminalModalProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<any>(null);
  const [status, setStatus] = useState<"connecting" | "ready" | "success" | "error" | "timeout">("connecting");
  const [countdown, setCountdown] = useState(300); // 5 minutes

  const cleanup = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (terminalRef.current) {
      terminalRef.current.dispose();
      terminalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open) {
      cleanup();
      setStatus("connecting");
      setCountdown(300);
      return;
    }

    let countdownInterval: ReturnType<typeof setInterval>;

    const initTerminal = async () => {
      // Dynamically import xterm to avoid SSR issues
      const { Terminal } = await import("@xterm/xterm");
      const { FitAddon } = await import("@xterm/addon-fit");
      await import("@xterm/xterm/css/xterm.css");

      if (!termRef.current || !open) return;

      const terminal = new Terminal({
        cursorBlink: true,
        theme: {
          background: "#18181b",
          foreground: "#fafafa",
        },
        fontSize: 13,
        fontFamily: "JetBrains Mono, monospace",
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(termRef.current);
      fitAddon.fit();
      terminalRef.current = terminal;

      terminal.writeln(`Connecting to ${provider} auth...`);

      // Get WS ticket
      const ticketRes = await fetch("/api/ws-ticket", { method: "POST" });
      const { ticket } = await ticketRes.json();

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/auth/terminal/${provider}?ticket=${ticket}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case "auth.ready":
              setStatus("ready");
              terminal.writeln("Container ready. Complete the login flow below:\n");
              break;
            case "data":
              terminal.write(msg.data);
              break;
            case "auth.success":
              setStatus("success");
              terminal.writeln("\n\n✓ Authentication successful!");
              setTimeout(() => {
                onSuccess();
                onOpenChange(false);
              }, 1500);
              break;
            case "auth.timeout":
              setStatus("timeout");
              terminal.writeln("\n\nTimeout — auth container destroyed.");
              break;
            case "auth.error":
              setStatus("error");
              terminal.writeln(`\n\nError: ${msg.message}`);
              break;
          }
        } catch {}
      };

      ws.onerror = () => {
        setStatus("error");
        terminal.writeln("\nWebSocket connection error.");
      };

      ws.onclose = () => {
        if (status !== "success") {
          terminal.writeln("\nConnection closed.");
        }
      };

      // Terminal input → WebSocket
      terminal.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "data", data }));
        }
      });

      // Countdown timer
      countdownInterval = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(countdownInterval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    };

    initTerminal();

    return () => {
      cleanup();
      if (countdownInterval) clearInterval(countdownInterval);
    };
  }, [open, provider]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TerminalIcon className="h-5 w-5" />
            Connect {provider === "claude" ? "Claude" : "Codex"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between text-sm text-zinc-400 mb-2">
          <span>
            {status === "connecting" && "Connecting..."}
            {status === "ready" && "Complete the login in the terminal below"}
            {status === "success" && "Connected successfully!"}
            {status === "error" && "Connection error"}
            {status === "timeout" && "Timed out"}
          </span>
          {status === "ready" && (
            <span className="tabular-nums">{formatTime(countdown)} remaining</span>
          )}
        </div>

        <div
          ref={termRef}
          className="h-[400px] rounded-md border border-zinc-800 bg-zinc-950 overflow-hidden"
        />

        <div className="flex justify-end gap-2 mt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={status === "success"}
          >
            {status === "success" ? "Done" : "Cancel"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /data/github/devbox/packages/ui && bunx tsc --noEmit`
Expected: No errors (may need to verify Dialog component exists from shadcn/ui)

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/auth-terminal-modal.tsx
git commit -m "feat(auth): add AuthTerminalModal component with xterm.js for CLI OAuth"
```

---

### Task 10: Update Settings UI with Provider Connections

**Files:**
- Modify: `packages/ui/src/components/settings-form.tsx`
- Modify: `packages/ui/src/lib/api.ts`

- [ ] **Step 1: Update auth API methods on `PatchworkAPI` class in `api.ts`**

In `packages/ui/src/lib/api.ts`, replace the existing auth methods on the `PatchworkAPI` class (lines ~533-553: `getAuthStatus`, `saveToken`, `removeToken`) with:

```typescript
  // Auth — Provider Credentials
  async getProviderStatus(): Promise<Record<string, {
    connected: boolean;
    authMethod?: string;
    lastUsedAt?: string;
    status?: string;
  }>> {
    return request("/api/auth/provider/status");
  }

  async storeProviderApiKey(provider: string, apiKey: string): Promise<{ provider: string; stored: boolean }> {
    return request(`/api/auth/provider/apikey/${provider}`, {
      method: "POST",
      body: JSON.stringify({ apiKey }),
    });
  }

  async disconnectProvider(provider: string): Promise<void> {
    return request(`/api/auth/provider/${provider}`, { method: "DELETE" });
  }
```

Note: The old `getAuthStatus()`, `saveToken()`, and `removeToken()` methods are removed since the endpoints they called no longer exist. The `PatchworkAPI` class uses its internal `request()` helper — follow the same pattern as existing methods.

- [ ] **Step 2: Update settings-form.tsx with Provider Connections section**

This replaces the current "anthropicApiKey" text field with a provider card layout. Add to the settings form:

```tsx
import { AuthTerminalModal } from "./auth-terminal-modal";
```

Add a "Provider Connections" section with cards for Claude and Codex. Each card shows:
- **Connected state**: badge (OAuth/API Key), last used date, "Disconnect" button
- **Disconnected state**: "Connect with CLI" button (opens terminal modal) and "Use API Key" (expandable input)
- **Expired state**: warning with "Reauthenticate" button

The exact UI implementation should follow the existing settings-form.tsx patterns (form fields, buttons, toast notifications).

- [ ] **Step 3: Remove the old `anthropicApiKey` field**

Remove the text input for `anthropicApiKey` from the settings form since credentials are now managed through the provider cards.

- [ ] **Step 4: Verify it compiles**

Run: `cd /data/github/devbox/packages/ui && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/settings-form.tsx packages/ui/src/lib/api.ts
git commit -m "feat(auth): add provider connections UI with CLI OAuth and API key options"
```

---

### Task 11: Build Auth Container Docker Image

**Files:**
- Create: `docker/Dockerfile.auth`

- [ ] **Step 1: Create the Dockerfile**

Create `docker/Dockerfile.auth` with a minimal image that includes:
- Base: `node:20-slim`
- Install Claude CLI: `npm install -g @anthropic-ai/claude-code`
- Install Codex CLI: `npm install -g @openai/codex`
- Create a non-root `user` user with home at `/home/user`
- Set `USER user` and `WORKDIR /home/user`
- Default `CMD` is just `bash` (the auth container service overrides CMD per provider)

Security: The image is intentionally minimal — no workspace mounts, no project files. Network is enabled (required for OAuth callbacks).

- [ ] **Step 2: Build the image**

```bash
cd /data/github/devbox && docker build -f docker/Dockerfile.auth -t patchwork-auth:latest .
```

- [ ] **Step 3: Verify the image works**

```bash
docker run --rm patchwork-auth:latest claude --version
docker run --rm patchwork-auth:latest codex --version
```

- [ ] **Step 4: Commit**

```bash
git add docker/Dockerfile.auth
git commit -m "feat(auth): add Dockerfile for ephemeral auth containers"
```

---

### Task 12: Migration script — migrate existing API keys

**Files:**
- Create: `packages/server/src/db/migrate-credentials.ts`

- [ ] **Step 1: Write the migration script**

```typescript
// packages/server/src/db/migrate-credentials.ts
import prisma from "./prisma.js";
import { CredentialStore } from "../auth/credential-store.js";

/**
 * One-time migration: move UserSettings.anthropicApiKey values into
 * the new ProviderCredential table (encrypted with per-user keys).
 *
 * Safe to run multiple times (uses upsert).
 */
export async function migrateCredentials(): Promise<{ migrated: number; skipped: number }> {
  const encKeyHex = process.env.PATCHWORK_ENCRYPTION_KEY;
  if (!encKeyHex) {
    throw new Error(
      "Cannot migrate credentials without PATCHWORK_ENCRYPTION_KEY. " +
      "Set this env var to a 64-character hex string (32 bytes) before running migration."
    );
  }

  const masterKey = Buffer.from(encKeyHex, "hex");
  const store = new CredentialStore(masterKey);

  const settingsWithKeys = await prisma.userSettings.findMany({
    where: {
      anthropicApiKey: { not: null },
    },
    select: {
      userId: true,
      anthropicApiKey: true,
    },
  });

  let migrated = 0;
  let skipped = 0;

  for (const settings of settingsWithKeys) {
    if (!settings.anthropicApiKey) {
      skipped++;
      continue;
    }

    try {
      await store.storeApiKey(settings.userId, "claude", settings.anthropicApiKey);
      migrated++;
      console.log(`[migrate] Migrated API key for user ${settings.userId}`);
    } catch (err: any) {
      console.error(`[migrate] Failed for user ${settings.userId}:`, err.message);
      skipped++;
    }
  }

  return { migrated, skipped };
}

// CLI entry point
if (import.meta.main) {
  migrateCredentials()
    .then(({ migrated, skipped }) => {
      console.log(`Migration complete: ${migrated} migrated, ${skipped} skipped`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Migration failed:", err.message);
      process.exit(1);
    });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /data/github/devbox && bunx tsc --noEmit packages/server/src/db/migrate-credentials.ts`

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/db/migrate-credentials.ts
git commit -m "feat(auth): add migration script for existing API keys to ProviderCredential"
```

---

### Task 13: Delete AuthProxy and clean up old code

**Files:**
- Delete: `packages/server/src/auth/proxy.ts`
- Modify: `packages/server/src/index.ts` (already done in Task 8)

- [ ] **Step 1: Delete the proxy file**

```bash
rm packages/server/src/auth/proxy.ts
```

- [ ] **Step 2: Search for any remaining imports of AuthProxy**

Run: `grep -r "AuthProxy\|auth/proxy" packages/server/src/ --include="*.ts"`
Expected: No results (all references should have been updated in Tasks 5, 7, 8)

If any remain, update them.

- [ ] **Step 3: Verify everything compiles**

Run: `cd /data/github/devbox && bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add -u packages/server/src/auth/proxy.ts
git commit -m "chore(auth): remove legacy AuthProxy in-memory token store"
```

---

## Dependency Graph

```
Task 1 (crypto) ─┐
                  ├→ Task 3 (credential store) ─┐
Task 2 (schema)  ─┘                              ├→ Task 5 (API endpoints)    ─┐
                                                  ├→ Task 6 (auth WS)          ├→ Task 8 (index.ts wiring)
                                                  ├→ Task 7 (thread creds)     ─┘         │
                                                  ├→ Task 7.5 (adapter inject) ─┘         │
                                                  │                                       ├→ Task 13 (delete proxy)
                                                  ├→ Task 12 (migration)                  │
                                                  └→ Task 9 (terminal modal) ─→ Task 10 (settings UI)
Task 11 (Dockerfile) — independent, can run in parallel
```

## Testing Strategy

- **Unit tests**: Tasks 1, 3, 4, 5 — test crypto, credential store, container lifecycle, API routes
- **Integration tests**: Task 7 — verify credential resolution with real DB
- **Manual testing**: Tasks 9, 10, 11 — UI components and Docker image
- **Migration test**: Task 12 — run against dev DB with test data

## Notes

- The `anthropicApiKey` column is NOT dropped from `UserSettings` in this plan — that happens in a follow-up after confirming migration success. The code just stops reading from it (falls through only if CredentialStore has nothing).
- `PATCHWORK_ENCRYPTION_KEY` is warned-about but not hard-required at server start (dev convenience). It IS required for the migration script.
- The existing `/api/auth/login` and `/api/auth/debug` endpoints are preserved (they're for server-level basic auth, not provider auth).
