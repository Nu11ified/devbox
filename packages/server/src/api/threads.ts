import { Router } from "express";
import { Effect } from "effect";
import prisma from "../db/prisma.js";
import type { ProviderService } from "../providers/service.js";
import { ThreadId } from "../providers/types.js";
import type { ProviderKind } from "../providers/types.js";

export function threadsRouter(providerService: ProviderService): Router {
  const router = Router();

  // List threads for current user
  router.get("/", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.json([]);
      }
      const threads = await prisma.thread.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        include: {
          _count: { select: { turns: true, events: true } },
        },
        take: 50,
      });
      res.json(threads);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get single thread with turns and recent events
  router.get("/:id", async (req, res) => {
    try {
      const thread = await prisma.thread.findUnique({
        where: { id: req.params.id },
        include: {
          turns: { orderBy: { startedAt: "asc" } },
          events: { orderBy: { sequence: "asc" }, take: 500 },
          sessions: { orderBy: { startedAt: "desc" }, take: 1 },
        },
      });
      if (!thread) return res.status(404).json({ error: "Thread not found" });
      res.json(thread);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create thread and start session
  router.post("/", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      const { title, provider, model, runtimeMode, workspacePath, useSubscription, issueId } = req.body;

      if (!title || !provider || !workspacePath) {
        return res.status(400).json({ error: "title, provider, and workspacePath are required" });
      }

      let subscription = useSubscription ?? false;
      if (userId && !useSubscription) {
        const settings = await prisma.userSettings.findUnique({ where: { userId } });
        if (provider === "claudeCode" && settings?.claudeSubscription) {
          subscription = true;
        }
      }

      let githubToken: string | undefined;
      if (userId) {
        const account = await prisma.account.findFirst({
          where: { userId, providerId: "github" },
        });
        githubToken = account?.accessToken ?? undefined;
      }

      const result = await Effect.runPromise(
        providerService.createThread({
          title,
          provider: provider as ProviderKind,
          model,
          runtimeMode: runtimeMode ?? "approval-required",
          workspacePath,
          useSubscription: subscription,
          githubToken,
          userId,
          issueId,
        })
      );

      res.status(201).json(result.thread);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Send turn
  router.post("/:id/turns", async (req, res) => {
    try {
      const { text, model, attachments } = req.body;
      if (!text) return res.status(400).json({ error: "text is required" });

      const result = await Effect.runPromise(
        providerService.sendTurn({
          threadId: ThreadId(req.params.id),
          text,
          model,
          attachments,
        })
      );
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Respond to approval request
  router.post("/:id/approve", async (req, res) => {
    try {
      const { requestId, decision } = req.body;
      if (!requestId || !decision) {
        return res.status(400).json({ error: "requestId and decision required" });
      }

      await Effect.runPromise(
        providerService.respondToRequest(
          ThreadId(req.params.id),
          requestId,
          decision
        )
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Interrupt current turn
  router.post("/:id/interrupt", async (req, res) => {
    try {
      await Effect.runPromise(
        providerService.interruptTurn(ThreadId(req.params.id))
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Stop thread session
  router.post("/:id/stop", async (req, res) => {
    try {
      await Effect.runPromise(
        providerService.stopThread(ThreadId(req.params.id))
      );
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete thread
  router.delete("/:id", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      const where: any = { id: req.params.id };
      if (userId) where.userId = userId;
      await prisma.thread.delete({ where });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
