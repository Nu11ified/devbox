import { Router } from "express";

const router = Router();

const startTime = Date.now();

router.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    uptime: Date.now() - startTime,
  });
});

export default router;
