import { Router, type Router as RouterType } from "express";
import {
  insertTemplate,
  findAllTemplates,
  findTemplateById,
  updateTemplate,
  removeTemplate,
} from "../db/queries.js";

export const templatesRouter: RouterType = Router();

// POST /api/templates
templatesRouter.post("/", async (req, res) => {
  const { name, baseImage, resourceLimits } = req.body;

  if (!name) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (!baseImage) {
    res.status(400).json({ error: "baseImage is required" });
    return;
  }
  if (!resourceLimits) {
    res.status(400).json({ error: "resourceLimits is required" });
    return;
  }

  try {
    const row = await insertTemplate(req.body);
    res.status(201).json(row);
  } catch (err: unknown) {
    const prismaErr = err as { code?: string };
    // Prisma P2002 = unique constraint violation, pg 23505 = unique_violation
    if (prismaErr.code === "P2002" || prismaErr.code === "23505") {
      res.status(409).json({ error: "Template with this name already exists" });
      return;
    }
    throw err;
  }
});

// GET /api/templates
templatesRouter.get("/", async (_req, res) => {
  const rows = await findAllTemplates();
  res.json(rows);
});

// GET /api/templates/:id
templatesRouter.get("/:id", async (req, res) => {
  const row = await findTemplateById(req.params.id);
  if (!row) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  res.json(row);
});

// PUT /api/templates/:id
templatesRouter.put("/:id", async (req, res) => {
  const row = await updateTemplate(req.params.id, req.body);
  if (!row) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  res.json(row);
});

// DELETE /api/templates/:id
templatesRouter.delete("/:id", async (req, res) => {
  const deleted = await removeTemplate(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Template not found" });
    return;
  }
  res.status(204).send();
});
