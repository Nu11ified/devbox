import express from "express";
import http from "node:http";
import healthRouter from "./routes/health.js";
import execRouter from "./routes/exec.js";
import gitRouter from "./routes/git.js";
import fsRouter from "./routes/fs.js";
import ptyRouter, { attachWebSocket } from "./routes/pty.js";

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(healthRouter);
  app.use(execRouter);
  app.use(gitRouter);
  app.use(fsRouter);
  app.use(ptyRouter);
  return app;
}

export { attachWebSocket } from "./routes/pty.js";

// Only start the server when run directly, not during tests
const isDirectRun =
  process.argv[1] &&
  !process.argv[1].includes("vitest") &&
  !process.argv[1].includes("node_modules");

if (isDirectRun) {
  const port = parseInt(process.env.SIDECAR_PORT ?? "9999", 10);
  const app = createApp();
  const server = http.createServer(app);
  attachWebSocket(server);
  server.listen(port, () => {
    console.log(`Sidecar listening on port ${port}`);
  });
}
