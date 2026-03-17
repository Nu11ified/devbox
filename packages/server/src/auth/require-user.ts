import type { RequestHandler } from "express";

/**
 * Middleware that requires an authenticated user on the request.
 * Returns 401 if no user is attached (i.e., session auth or OAuth didn't succeed).
 *
 * Use on any route that needs multi-tenant data isolation.
 */
export function requireUser(): RequestHandler {
  return (req, res, next) => {
    const user = (req as any).user;
    if (!user?.id) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    next();
  };
}

/** Extract userId from request, throwing if absent. */
export function getUserId(req: any): string {
  const id = req.user?.id;
  if (!id) throw new Error("No authenticated user");
  return id;
}
