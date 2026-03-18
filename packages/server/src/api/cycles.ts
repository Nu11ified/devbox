import { Router } from "express";
import prisma from "../db/prisma.js";

export function cyclesRouter(): Router {
  const r = Router({ mergeParams: true });

  // Get active cycle for a thread
  r.get("/", async (req, res) => {
    try {
      const { threadId } = req.params as any;

      const run = await prisma.cycleRun.findFirst({
        where: { threadId, status: "running" },
        include: { nodeResults: { orderBy: { startedAt: "asc" } } },
      });

      if (!run) return res.status(404).json({ error: "No active cycle" });
      res.json(run);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get cycle run history for a thread
  r.get("/history", async (req, res) => {
    try {
      const { threadId } = req.params as any;

      const runs = await prisma.cycleRun.findMany({
        where: { threadId },
        include: { nodeResults: { orderBy: { startedAt: "asc" } } },
        orderBy: { startedAt: "desc" },
      });

      res.json(runs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return r;
}
