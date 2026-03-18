import { Router } from "express";
import prisma from "../db/prisma.js";
import { requireUser, getUserId } from "../auth/require-user.js";

export function cyclesRouter(): Router {
  const r = Router({ mergeParams: true });

  // Get active cycle for a thread
  r.get("/", requireUser(), async (req, res) => {
    try {
      const userId = getUserId(req);
      const { threadId } = req.params as any;

      // Verify thread belongs to user
      const thread = await prisma.thread.findFirst({
        where: { id: threadId, userId },
      });
      if (!thread) return res.status(404).json({ error: "Thread not found" });

      const run = await prisma.cycleRun.findFirst({
        where: { threadId, status: "running" },
        include: { nodeResults: { orderBy: { createdAt: "asc" } } },
      });

      if (!run) return res.status(404).json({ error: "No active cycle" });
      res.json(run);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get cycle run history for a thread
  r.get("/history", requireUser(), async (req, res) => {
    try {
      const userId = getUserId(req);
      const { threadId } = req.params as any;

      // Verify thread belongs to user
      const thread = await prisma.thread.findFirst({
        where: { id: threadId, userId },
      });
      if (!thread) return res.status(404).json({ error: "Thread not found" });

      const runs = await prisma.cycleRun.findMany({
        where: { threadId },
        include: { nodeResults: { orderBy: { createdAt: "asc" } } },
        orderBy: { startedAt: "desc" },
      });

      res.json(runs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return r;
}
