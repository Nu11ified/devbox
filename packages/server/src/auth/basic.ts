import type { RequestHandler } from "express";

function clean(s: string | undefined): string {
  if (!s) return "";
  let v = s.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v;
}

/**
 * Basic auth middleware gated on PATCHWORK_USERNAME / PATCHWORK_PASSWORD env vars.
 * When both are set, every request must carry a valid Authorization header.
 * When either is unset, requests pass through (dev mode).
 */
export function basicAuth(): RequestHandler {
  const username = clean(process.env.PATCHWORK_USERNAME);
  const password = clean(process.env.PATCHWORK_PASSWORD);

  return (req, res, next) => {
    // Skip basic auth if session middleware already authenticated
    if ((req as any).user) {
      return next();
    }

    if (!username || !password) {
      return next();
    }

    // Allow unauthenticated access to health and login
    if (req.path === "/api/health" || req.path === "/api/auth/login") {
      return next();
    }

    const header = req.headers.authorization;
    if (!header || !header.startsWith("Basic ")) {
      res.setHeader("WWW-Authenticate", 'Basic realm="Patchwork"');
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const decoded = Buffer.from(header.slice(6), "base64").toString();
    const colonIdx = decoded.indexOf(":");
    const user = colonIdx === -1 ? decoded : decoded.slice(0, colonIdx);
    const pass = colonIdx === -1 ? "" : decoded.slice(colonIdx + 1);

    if (user === username && pass === password) {
      return next();
    }

    res.setHeader("WWW-Authenticate", 'Basic realm="Patchwork"');
    res.status(401).json({ error: "Invalid credentials" });
  };
}
