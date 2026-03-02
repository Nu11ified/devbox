import type { RequestHandler } from "express";

/**
 * Basic auth middleware gated on PATCHWORK_USERNAME / PATCHWORK_PASSWORD env vars.
 * When both are set, every request must carry a valid Authorization header.
 * When either is unset, requests pass through (dev mode).
 */
export function basicAuth(): RequestHandler {
  const username = process.env.PATCHWORK_USERNAME;
  const password = process.env.PATCHWORK_PASSWORD;

  return (req, res, next) => {
    if (!username || !password) {
      return next();
    }

    // Allow health check without auth
    if (req.path === "/api/health") {
      return next();
    }

    const header = req.headers.authorization;
    if (!header || !header.startsWith("Basic ")) {
      res.setHeader("WWW-Authenticate", 'Basic realm="Patchwork"');
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const decoded = Buffer.from(header.slice(6), "base64").toString();
    const [user, pass] = decoded.split(":");

    if (user === username && pass === password) {
      return next();
    }

    res.setHeader("WWW-Authenticate", 'Basic realm="Patchwork"');
    res.status(401).json({ error: "Invalid credentials" });
  };
}
