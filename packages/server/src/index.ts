import express from "express";

export function createApp(): express.Express {
  const app = express();

  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", version: "0.1.0" });
  });

  return app;
}

// Start server when run directly
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("/index.ts") ||
    process.argv[1].endsWith("/index.js"));

if (isMain) {
  const PORT = parseInt(process.env.PORT || "3001", 10);
  const app = createApp();

  app.listen(PORT, () => {
    console.log(`Patchwork server listening on port ${PORT}`);
  });
}
