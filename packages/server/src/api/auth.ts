import { Router } from "express";
import type { AuthProxy } from "../auth/proxy.js";

const VALID_PROVIDERS = new Set(["claude", "codex"]);

export function authRouter(proxy: AuthProxy): Router {
  const router = Router();

  // POST /api/auth/login — validate credentials against env vars
  router.post("/login", (req, res) => {
    const serverUsername = process.env.PATCHWORK_USERNAME;
    const serverPassword = process.env.PATCHWORK_PASSWORD;

    console.log(`[auth/login] env PATCHWORK_USERNAME set: ${!!serverUsername}, len: ${serverUsername?.length ?? 0}`);
    console.log(`[auth/login] env PATCHWORK_PASSWORD set: ${!!serverPassword}, len: ${serverPassword?.length ?? 0}`);
    console.log(`[auth/login] req.body keys: ${JSON.stringify(Object.keys(req.body || {}))}`);
    console.log(`[auth/login] req.body.username: "${req.body?.username}", len: ${req.body?.username?.length ?? 0}`);
    console.log(`[auth/login] req.body.password set: ${!!req.body?.password}, len: ${req.body?.password?.length ?? 0}`);

    // No auth configured — accept any credentials
    if (!serverUsername || !serverPassword) {
      console.log("[auth/login] no auth configured, accepting");
      res.json({ authenticated: true });
      return;
    }

    const { username, password } = req.body ?? {};
    const usernameMatch = username === serverUsername;
    const passwordMatch = password === serverPassword;
    console.log(`[auth/login] username match: ${usernameMatch}, password match: ${passwordMatch}`);

    if (usernameMatch && passwordMatch) {
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
      usernameFirst2: u?.slice(0, 2) ?? "",
      serverVersion: "2025-03-05-v2",
    });
  });

  // POST /api/auth/tokens — store encrypted token
  router.post("/tokens", async (req, res) => {
    const { provider, token } = req.body;

    if (!provider || !token) {
      res.status(400).json({ error: "provider and token are required" });
      return;
    }

    if (!VALID_PROVIDERS.has(provider)) {
      res.status(400).json({ error: `Invalid provider: ${provider}. Must be one of: ${[...VALID_PROVIDERS].join(", ")}` });
      return;
    }

    await proxy.storeToken(provider, token);
    res.status(201).json({ provider, stored: true });
  });

  // GET /api/auth/tokens — list stored providers (NOT the tokens)
  router.get("/tokens", (_req, res) => {
    const providers = proxy.listProviders();
    res.json({ providers });
  });

  // DELETE /api/auth/tokens/:provider — remove token
  router.delete("/tokens/:provider", async (req, res) => {
    const { provider } = req.params;
    const removed = await proxy.removeToken(provider);

    if (!removed) {
      res.status(404).json({ error: `No token found for provider: ${provider}` });
      return;
    }

    res.json({ provider, removed: true });
  });

  // GET /api/auth/status — check token validity for all providers
  router.get("/status", async (_req, res) => {
    const providers: Record<string, { valid: boolean; expiresIn?: number }> = {};

    for (const name of VALID_PROVIDERS) {
      providers[name] = await proxy.checkExpiry(name);
    }

    res.json({ providers });
  });

  return router;
}
