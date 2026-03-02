import express from "express";
import healthRouter from "./routes/health.js";
import execRouter from "./routes/exec.js";

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(healthRouter);
  app.use(execRouter);
  return app;
}

// Only start the server when run directly, not during tests
const isDirectRun =
  process.argv[1] &&
  !process.argv[1].includes("vitest") &&
  !process.argv[1].includes("node_modules");

if (isDirectRun) {
  const port = parseInt(process.env.SIDECAR_PORT ?? "9999", 10);
  const app = createApp();
  app.listen(port, () => {
    console.log(`Sidecar listening on port ${port}`);
  });
}
