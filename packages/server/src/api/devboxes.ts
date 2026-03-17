import { Router, type Router as RouterType } from "express";
import { DevboxManager } from "../devbox/manager.js";
import { requireUser } from "../auth/require-user.js";

const manager = new DevboxManager();

export const devboxesRouter: RouterType = Router();

// GET /api/devboxes — list active devboxes
devboxesRouter.get("/", requireUser(), async (_req, res) => {
  const containers = await manager.list();
  res.json(containers);
});

// POST /api/devboxes — create a devbox
devboxesRouter.post("/", requireUser(), async (req, res) => {
  const { image, name, env, cpus, memoryMB, networkMode } = req.body;

  if (!image) {
    res.status(400).json({ error: "image is required" });
    return;
  }

  const info = await manager.create({
    image,
    name,
    env,
    cpus,
    memoryMB,
    networkMode,
  });
  res.status(201).json(info);
});

// DELETE /api/devboxes/:id — destroy a devbox
devboxesRouter.delete("/:id", requireUser(), async (req, res) => {
  try {
    await manager.destroy(req.params.id as string);
    res.status(204).send();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("no such container") || msg.includes("Not Found")) {
      res.status(404).json({ error: "Devbox not found" });
      return;
    }
    throw err;
  }
});

// GET /api/devboxes/:id/status — get devbox status
devboxesRouter.get("/:id/status", requireUser(), async (req, res) => {
  try {
    const containers = await manager.list();
    const found = containers.find((c) => c.containerId === req.params.id);
    if (!found) {
      res.status(404).json({ error: "Devbox not found" });
      return;
    }
    res.json(found);
  } catch {
    res.status(404).json({ error: "Devbox not found" });
  }
});
