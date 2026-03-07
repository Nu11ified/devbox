import express from "express";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { templatesRouter } from "./api/templates.js";
import { devboxesRouter } from "./api/devboxes.js";
import { runsRouter } from "./api/runs.js";
import { issuesRouter } from "./api/issues.js";
import { blueprintsRouter } from "./api/blueprints.js";
import { authRouter } from "./api/auth.js";
import { setupWebSocket } from "./api/ws.js";
import { setupThreadWebSocket } from "./api/thread-ws.js";
import { AuthProxy } from "./auth/proxy.js";
import { basicAuth } from "./auth/basic.js";
import { sessionAuth } from "./auth/session-middleware.js";
import { githubRouter } from "./api/github.js";
import { settingsRouter } from "./api/settings.js";
import { Orchestrator } from "./orchestrator/index.js";
import { GitHubSyncJob } from "./github/sync.js";
import { runMigration } from "./db/migrate.js";
import { seedDefaultTemplate } from "./db/seed.js";
import { ProviderAdapterRegistry, ProviderService, ClaudeCodeAdapter, CodexAdapter } from "./providers/index.js";
import { threadsRouter } from "./api/threads.js";

export function createApp(): { app: express.Express; providerService: ProviderService } {
  const app = express();

  // Try session auth first (better-auth), fall through to basic auth
  app.use(sessionAuth());
  app.use(basicAuth());
  app.use(express.json());

  // Auth proxy with encryption key from env or random (dev)
  const encKeyHex = process.env.PATCHWORK_ENCRYPTION_KEY;
  const encKey = encKeyHex ? Buffer.from(encKeyHex, "hex") : randomBytes(32);
  const authProxy = new AuthProxy(encKey);

  // Provider adapter system
  const adapterRegistry = new ProviderAdapterRegistry();
  adapterRegistry.register(new ClaudeCodeAdapter());
  adapterRegistry.register(new CodexAdapter());
  const providerService = new ProviderService(adapterRegistry);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", version: "0.1.0" });
  });

  app.use("/api/templates", templatesRouter);
  app.use("/api/devboxes", devboxesRouter);
  app.use("/api/runs", runsRouter);
  app.use("/api/issues", issuesRouter);
  app.use("/api/blueprints", blueprintsRouter);
  app.use("/api/auth", authRouter(authProxy));
  app.use("/api/github", githubRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/threads", threadsRouter(providerService));

  return { app, providerService };
}

// Start server when run directly
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("/index.ts") ||
    process.argv[1].endsWith("/index.js"));

if (isMain) {
  (async () => {
    await runMigration();
    await seedDefaultTemplate();

    const PORT = parseInt(process.env.PORT || "3001", 10);
    const { app, providerService } = createApp();
    const server = createServer(app);

    setupWebSocket(server);
    setupThreadWebSocket(server, providerService);

    server.listen(PORT, () => {
      console.log(`Patchwork server listening on port ${PORT}`);
    });

    const orchestrator = new Orchestrator(providerService);
    orchestrator.start();

    const syncJob = new GitHubSyncJob();
    syncJob.start();

    process.on("SIGTERM", () => {
      orchestrator.stop();
      syncJob.stop();
      server.close();
    });
  })();
}
