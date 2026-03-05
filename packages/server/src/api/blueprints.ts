import { Router, type Router as RouterType } from "express";
import { BUILTIN_BLUEPRINTS } from "../blueprints/definitions.js";

export const blueprintsRouter: RouterType = Router();

// GET /api/blueprints — list all built-in blueprints
blueprintsRouter.get("/", (_req, res) => {
  res.json([...BUILTIN_BLUEPRINTS.values()]);
});

// GET /api/blueprints/:id — get a specific blueprint
blueprintsRouter.get("/:id", (req, res) => {
  const blueprint = BUILTIN_BLUEPRINTS.get(req.params.id);
  if (!blueprint) {
    res.status(404).json({ error: "Blueprint not found" });
    return;
  }
  res.json(blueprint);
});
