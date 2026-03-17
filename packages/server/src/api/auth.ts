import { Router } from "express";
import type { AuthProxy } from "../auth/proxy.js";
import { requireUser, getUserId } from "../auth/require-user.js";

const VALID_PROVIDERS = new Set(["claude", "codex"]);

export function authRouter(proxy: AuthProxy): Router {
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

    // No auth configured — accept any credentials
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

  // POST /api/auth/tokens — store encrypted token
  router.post("/tokens", requireUser(), async (req, res) => {
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
  router.get("/tokens", requireUser(), (_req, res) => {
    const providers = proxy.listProviders();
    res.json({ providers });
  });

  // DELETE /api/auth/tokens/:provider — remove token
  router.delete("/tokens/:provider", requireUser(), async (req, res) => {
    const { provider } = req.params;
    const removed = await proxy.removeToken(provider);

    if (!removed) {
      res.status(404).json({ error: `No token found for provider: ${provider}` });
      return;
    }

    res.json({ provider, removed: true });
  });

  // GET /api/auth/status — check token validity for all providers
  router.get("/status", requireUser(), async (_req, res) => {
    const result: Record<string, { connected: boolean }> = {};

    for (const name of VALID_PROVIDERS) {
      const status = await proxy.checkExpiry(name);
      result[name] = { connected: status.valid };
    }

    res.json(result);
  });

  return router;
}
