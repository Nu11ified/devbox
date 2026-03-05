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
      return next(); // Fall through to basic auth
    }

    try {
      const session = await prisma.session.findUnique({
        where: { token },
        include: { user: true },
      });

      if (!session || session.expiresAt < new Date()) {
        return next(); // Fall through to basic auth
      }

      (req as any).user = session.user;
      (req as any).session = session;
      next();
    } catch {
      next(); // Fall through to basic auth on DB errors
    }
  };
}
