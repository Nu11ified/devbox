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
import { setupThreadWebSocket, setupProjectEventsWebSocket } from "./api/thread-ws.js";
import { AuthProxy } from "./auth/proxy.js";
import { issueWsTicket } from "./auth/ws-tickets.js";
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
import { pluginsRouter } from "./api/plugins.js";
import { projectsRouter } from "./api/projects.js";
import { ankiRouter } from "./api/anki.js";
import { archiveRouter } from "./api/archive.js";
import { teamsRouter } from "./api/teams.js";
import { cyclesRouter } from "./api/cycles.js";
import { PluginSyncJob } from "./plugins/sync.js";
import prisma from "./db/prisma.js";
import { startArchiveJob } from "./orchestrator/archive-job.js";

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

  // Issue short-lived WebSocket tickets for cross-origin connections
  app.post("/api/ws-ticket", (req, res) => {
    const user = (req as any).user;
    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const ticket = issueWsTicket(user.id);
    res.json({ ticket });
  });

  app.use("/api/templates", templatesRouter);
  app.use("/api/devboxes", devboxesRouter);
  app.use("/api/runs", runsRouter);
  app.use("/api/issues", issuesRouter);
  app.use("/api/blueprints", blueprintsRouter);
  app.use("/api/auth", authRouter(authProxy));
  app.use("/api/github", githubRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/threads", threadsRouter(providerService, authProxy));
  app.use("/api/plugins", pluginsRouter());
  app.use("/api/projects", projectsRouter());
  app.use("/api/projects/:projectId/anki", ankiRouter());
  app.use("/api/archive", archiveRouter);
  app.use("/api/projects/:projectId/teams", teamsRouter(providerService, authProxy));
  app.use("/api/threads/:threadId/cycle", cyclesRouter());

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
    // Create full-text search GIN indexes (idempotent)
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS idx_thread_turns_search
          ON thread_turns USING GIN (to_tsvector('english', COALESCE(content, '')));
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS idx_issues_title_search
          ON issues USING GIN (to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(body, '')));
      `);
      console.log("Full-text search indexes ready");
    } catch (err) {
      console.warn("GIN index creation skipped (may already exist):", (err as Error).message);
    }

    const PORT = parseInt(process.env.PORT || "3001", 10);
    const { app, providerService } = createApp();
    const server = createServer(app);

    setupWebSocket(server);
    setupThreadWebSocket(server, providerService);
    setupProjectEventsWebSocket(server);

    server.listen(PORT, () => {
      console.log(`Patchwork server listening on port ${PORT}`);
    });

    const orchestrator = new Orchestrator(providerService);
    orchestrator.start();

    const syncJob = new GitHubSyncJob();
    syncJob.start();

    const archiveJob = startArchiveJob();

    const pluginSyncJob = new PluginSyncJob();
    await pluginSyncJob.start();

    process.on("SIGTERM", () => {
      orchestrator.stop();
      syncJob.stop();
      archiveJob.stop();
      pluginSyncJob.stop();
      server.close();
    });
  })();
}
