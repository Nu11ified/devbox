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

      await authContainerService.destroyContainer(userId);
      await credentialStore.revokeCredential(userId, provider);
      res.json({ provider, removed: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
