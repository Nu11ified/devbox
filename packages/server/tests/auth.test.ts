import { describe, it, expect, vi, beforeEach } from "vitest";
import { encrypt, decrypt } from "../src/auth/crypto.js";
import { AuthProxy } from "../src/auth/proxy.js";
import { randomBytes } from "node:crypto";
import request from "supertest";
import express from "express";
import { authRouter } from "../src/api/auth.js";

// --- crypto.ts tests ---

describe("encrypt / decrypt", () => {
  const key = randomBytes(32);

  it("round-trips a short string", () => {
    const plaintext = "sk-ant-api03-secret-token";
    const encrypted = encrypt(plaintext, key);
    expect(encrypted).toHaveProperty("encrypted");
    expect(encrypted).toHaveProperty("iv");
    expect(encrypted).toHaveProperty("tag");
    expect(encrypted.encrypted).not.toBe(plaintext);

    const decrypted = decrypt(encrypted, key);
    expect(decrypted).toBe(plaintext);
  });

  it("round-trips an empty string", () => {
    const encrypted = encrypt("", key);
    expect(decrypt(encrypted, key)).toBe("");
  });

  it("round-trips a long token", () => {
    const longToken = "x".repeat(4096);
    const encrypted = encrypt(longToken, key);
    expect(decrypt(encrypted, key)).toBe(longToken);
  });

  it("produces different ciphertext for same plaintext (random IV)", () => {
    const plaintext = "same-token";
    const a = encrypt(plaintext, key);
    const b = encrypt(plaintext, key);
    expect(a.encrypted).not.toBe(b.encrypted);
    expect(a.iv).not.toBe(b.iv);
  });

  it("fails to decrypt with wrong key", () => {
    const encrypted = encrypt("secret", key);
    const wrongKey = randomBytes(32);
    expect(() => decrypt(encrypted, wrongKey)).toThrow();
  });

  it("fails to decrypt with tampered ciphertext", () => {
    const encrypted = encrypt("secret", key);
    encrypted.encrypted = "00" + encrypted.encrypted.slice(2);
    expect(() => decrypt(encrypted, key)).toThrow();
  });

  it("fails to decrypt with tampered tag", () => {
    const encrypted = encrypt("secret", key);
    encrypted.tag = "00" + encrypted.tag.slice(2);
    expect(() => decrypt(encrypted, key)).toThrow();
  });
});

// --- AuthProxy tests ---

describe("AuthProxy", () => {
  let proxy: AuthProxy;

  beforeEach(() => {
    proxy = new AuthProxy(randomBytes(32));
  });

  it("stores and retrieves a token", async () => {
    await proxy.storeToken("claude", "claude-secret-123");
    const token = await proxy.getToken("claude");
    expect(token).toBe("claude-secret-123");
  });

  it("stores tokens for multiple providers", async () => {
    await proxy.storeToken("claude", "claude-token");
    await proxy.storeToken("codex", "codex-token");

    expect(await proxy.getToken("claude")).toBe("claude-token");
    expect(await proxy.getToken("codex")).toBe("codex-token");
  });

  it("returns null for unknown provider", async () => {
    const token = await proxy.getToken("claude");
    expect(token).toBeNull();
  });

  it("overwrites existing token for same provider", async () => {
    await proxy.storeToken("claude", "old-token");
    await proxy.storeToken("claude", "new-token");
    expect(await proxy.getToken("claude")).toBe("new-token");
  });

  it("removes a stored token", async () => {
    await proxy.storeToken("claude", "token-to-remove");
    await proxy.removeToken("claude");
    expect(await proxy.getToken("claude")).toBeNull();
  });

  it("lists stored providers without exposing tokens", async () => {
    await proxy.storeToken("claude", "secret1");
    await proxy.storeToken("codex", "secret2");
    const providers = proxy.listProviders();
    expect(providers).toEqual(expect.arrayContaining(["claude", "codex"]));
    expect(providers).toHaveLength(2);
  });

  it("checkExpiry returns valid for recently stored token", async () => {
    await proxy.storeToken("claude", "fresh-token");
    const status = await proxy.checkExpiry("claude");
    expect(status.valid).toBe(true);
    expect(status.expiresIn).toBeUndefined();
  });

  it("checkExpiry returns invalid for missing provider", async () => {
    const status = await proxy.checkExpiry("claude");
    expect(status.valid).toBe(false);
  });

  it("injects token into container via sidecar mock", async () => {
    await proxy.storeToken("claude", "injected-token");

    const mockSidecar = {
      exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
      gitDiff: vi.fn(),
      gitApply: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn().mockResolvedValue(undefined),
    };

    await proxy.injectIntoContainer("container-1", "claude", mockSidecar);

    expect(mockSidecar.writeFile).toHaveBeenCalledWith(
      "/workspace/.env.patchwork",
      expect.stringContaining("injected-token")
    );
  });
});

// --- Auth API routes tests ---

describe("Auth API routes", () => {
  let app: express.Express;
  let proxy: AuthProxy;

  beforeEach(() => {
    proxy = new AuthProxy(randomBytes(32));
    app = express();
    app.use(express.json());
    app.use("/api/auth", authRouter(proxy));
  });

  it("POST /api/auth/tokens stores a token", async () => {
    const res = await request(app)
      .post("/api/auth/tokens")
      .send({ provider: "claude", token: "my-secret" });

    expect(res.status).toBe(201);
    expect(res.body.provider).toBe("claude");
  });

  it("POST /api/auth/tokens rejects missing provider", async () => {
    const res = await request(app)
      .post("/api/auth/tokens")
      .send({ token: "my-secret" });

    expect(res.status).toBe(400);
  });

  it("POST /api/auth/tokens rejects missing token", async () => {
    const res = await request(app)
      .post("/api/auth/tokens")
      .send({ provider: "claude" });

    expect(res.status).toBe(400);
  });

  it("POST /api/auth/tokens rejects invalid provider", async () => {
    const res = await request(app)
      .post("/api/auth/tokens")
      .send({ provider: "invalid", token: "my-secret" });

    expect(res.status).toBe(400);
  });

  it("GET /api/auth/tokens lists providers without tokens", async () => {
    await proxy.storeToken("claude", "secret1");
    await proxy.storeToken("codex", "secret2");

    const res = await request(app).get("/api/auth/tokens");

    expect(res.status).toBe(200);
    expect(res.body.providers).toEqual(expect.arrayContaining(["claude", "codex"]));
    // Must NOT contain actual tokens
    expect(JSON.stringify(res.body)).not.toContain("secret1");
    expect(JSON.stringify(res.body)).not.toContain("secret2");
  });

  it("DELETE /api/auth/tokens/:provider removes token", async () => {
    await proxy.storeToken("claude", "to-delete");

    const res = await request(app).delete("/api/auth/tokens/claude");
    expect(res.status).toBe(200);

    const token = await proxy.getToken("claude");
    expect(token).toBeNull();
  });

  it("DELETE /api/auth/tokens/:provider returns 404 for unknown", async () => {
    const res = await request(app).delete("/api/auth/tokens/claude");
    expect(res.status).toBe(404);
  });

  it("GET /api/auth/status returns validity for all providers", async () => {
    await proxy.storeToken("claude", "valid-token");

    const res = await request(app).get("/api/auth/status");

    expect(res.status).toBe(200);
    expect(res.body.claude).toBeDefined();
    expect(res.body.claude.connected).toBe(true);
  });
});
