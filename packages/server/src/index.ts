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
import { AuthProxy } from "./auth/proxy.js";
import { basicAuth } from "./auth/basic.js";
import { Orchestrator } from "./orchestrator/index.js";
import { runMigration } from "./db/migrate.js";

export function createApp(): express.Express {
  const app = express();

  app.use(basicAuth());
  app.use(express.json());

  // Auth proxy with encryption key from env or random (dev)
  const encKeyHex = process.env.PATCHWORK_ENCRYPTION_KEY;
  const encKey = encKeyHex ? Buffer.from(encKeyHex, "hex") : randomBytes(32);
  const authProxy = new AuthProxy(encKey);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", version: "0.1.0" });
  });

  app.use("/api/templates", templatesRouter);
  app.use("/api/devboxes", devboxesRouter);
  app.use("/api/runs", runsRouter);
  app.use("/api/issues", issuesRouter);
  app.use("/api/blueprints", blueprintsRouter);
  app.use("/api/auth", authRouter(authProxy));

  return app;
}

// Start server when run directly
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("/index.ts") ||
    process.argv[1].endsWith("/index.js"));

if (isMain) {
  (async () => {
    await runMigration();

    const PORT = parseInt(process.env.PORT || "3001", 10);
    const app = createApp();
    const server = createServer(app);

    setupWebSocket(server);

    server.listen(PORT, () => {
      console.log(`Patchwork server listening on port ${PORT}`);
    });

    const orchestrator = new Orchestrator();
    orchestrator.start();

    process.on("SIGTERM", () => {
      orchestrator.stop();
      server.close();
    });
  })();
}
