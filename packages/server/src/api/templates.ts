import { Router } from "express";
import {
  insertTemplate,
  findAllTemplates,
  findTemplateById,
  updateTemplate,
  removeTemplate,
} from "../db/queries.js";

export const templatesRouter = Router();

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
    const pgErr = err as { code?: string };
    if (pgErr.code === "23505") {
      // unique_violation
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
