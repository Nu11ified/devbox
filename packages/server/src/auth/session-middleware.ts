import type { RequestHandler } from "express";
import prisma from "../db/prisma.js";

function extractSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";").map((c) => c.trim());
  for (const cookie of cookies) {
    // better-auth stores session token in "better-auth.session_token" cookie
    if (cookie.startsWith("better-auth.session_token=")) {
      return decodeURIComponent(cookie.slice("better-auth.session_token=".length));
    }
  }
  return null;
}

export function sessionAuth(): RequestHandler {
  return async (req, res, next) => {
    // Allow unauthenticated access to health endpoint
    if (req.path === "/api/health") return next();

    const token = extractSessionToken(req.headers.cookie);
    if (!token) {
      return next(); // No session cookie — fall through to basic auth
    }

    // Session cookie is present — authenticate via DB or reject.
    // Do NOT fall through to basic auth when a session cookie exists,
    // because basicAuth's WWW-Authenticate header triggers the browser's
    // native prompt loop.
    try {
      const session = await prisma.session.findUnique({
        where: { token },
        include: { user: true },
      });

      if (!session || session.expiresAt < new Date()) {
        res.status(401).json({ error: "Session expired" });
        return;
      }

      (req as any).user = session.user;
      (req as any).session = session;
      next();
    } catch (err) {
      console.error("[sessionAuth] DB lookup failed:", err);
      res.status(500).json({ error: "Session validation failed" });
    }
  };
}
