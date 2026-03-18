import { Router } from "express";
import prisma from "../db/prisma.js";

// Validation constants
const MAX_GROUP_LENGTH = 50;
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENTS_LENGTH = 10000;
const MAX_REFERENCED_FILES = 20;
const MAX_FILE_PATH_LENGTH = 500;
const GROUP_PATTERN = /^[a-z0-9-]+$/;

function validateCardInput(body: any): string | null {
  const { group, title, contents, referencedFiles } = body;

  if (group !== undefined) {
    if (typeof group !== "string" || group.length === 0) {
      return "group must be a non-empty string";
    }
    if (group.length > MAX_GROUP_LENGTH) {
      return `group must be at most ${MAX_GROUP_LENGTH} characters`;
    }
    if (!GROUP_PATTERN.test(group)) {
      return "group must contain only lowercase letters, numbers, and hyphens";
    }
  }

  if (title !== undefined) {
    if (typeof title !== "string" || title.length === 0) {
      return "title must be a non-empty string";
    }
    if (title.length > MAX_TITLE_LENGTH) {
      return `title must be at most ${MAX_TITLE_LENGTH} characters`;
    }
  }

  if (contents !== undefined) {
    if (typeof contents !== "string" || contents.length === 0) {
      return "contents must be a non-empty string";
    }
    if (contents.length > MAX_CONTENTS_LENGTH) {
      return `contents must be at most ${MAX_CONTENTS_LENGTH} characters`;
    }
  }

  if (referencedFiles !== undefined) {
    if (!Array.isArray(referencedFiles)) {
      return "referencedFiles must be an array";
    }
    if (referencedFiles.length > MAX_REFERENCED_FILES) {
      return `referencedFiles must contain at most ${MAX_REFERENCED_FILES} entries`;
    }
    for (const file of referencedFiles) {
      if (typeof file !== "string") {
        return "each referencedFiles entry must be a string";
      }
      if (file.length > MAX_FILE_PATH_LENGTH) {
        return `each referencedFiles entry must be at most ${MAX_FILE_PATH_LENGTH} characters`;
      }
    }
  }

  return null;
}

export function ankiRouter(): Router {
  const r = Router({ mergeParams: true });

  // List cards for project
  r.get("/", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { projectId } = req.params as any;

      const project = await prisma.project.findFirst({
        where: { id: projectId, userId },
      });
      if (!project) return res.status(404).json({ error: "Project not found" });

      const where: any = { projectId };

      if (req.query.group) {
        where.group = req.query.group as string;
      }

      if (req.query.stale !== undefined) {
        where.stale = req.query.stale === "true";
      }

      const cards = await prisma.ankiCard.findMany({
        where,
        orderBy: { accessCount: "desc" },
      });

      res.json(cards);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get single card
  r.get("/:cardId", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { projectId, cardId } = req.params as any;

      const card = await prisma.ankiCard.findFirst({
        where: {
          id: cardId,
          project: { id: projectId, userId },
        },
      });
      if (!card) return res.status(404).json({ error: "Card not found" });

      res.json(card);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create card
  r.post("/", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { projectId } = req.params as any;

      const project = await prisma.project.findFirst({
        where: { id: projectId, userId },
      });
      if (!project) return res.status(404).json({ error: "Project not found" });

      const { group, title, contents, referencedFiles = [], createdByThreadId } = req.body;

      // Validate required fields
      if (!group) return res.status(400).json({ error: "group is required" });
      if (!title) return res.status(400).json({ error: "title is required" });
      if (!contents) return res.status(400).json({ error: "contents is required" });

      const validationError = validateCardInput(req.body);
      if (validationError) return res.status(400).json({ error: validationError });

      const normalizedGroup = group.toLowerCase();

      try {
        const card = await prisma.ankiCard.create({
          data: {
            projectId,
            group: normalizedGroup,
            title,
            contents,
            referencedFiles,
            createdByThreadId: createdByThreadId || null,
          },
        });
        res.status(201).json(card);
      } catch (err: any) {
        if (err.code === "P2002") {
          return res.status(409).json({ error: "A card with this group and title already exists" });
        }
        throw err;
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update card
  r.put("/:cardId", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { projectId, cardId } = req.params as any;

      const existing = await prisma.ankiCard.findFirst({
        where: {
          id: cardId,
          project: { id: projectId, userId },
        },
      });
      if (!existing) return res.status(404).json({ error: "Card not found" });

      // Partial validation — only validate fields that are present
      const validationError = validateCardInput(req.body);
      if (validationError) return res.status(400).json({ error: validationError });

      const { group, title, contents, referencedFiles, stale, staleReason, updatedByThreadId } = req.body;

      const data: any = {};

      if (group !== undefined) data.group = (group as string).toLowerCase();
      if (title !== undefined) data.title = title;
      if (referencedFiles !== undefined) data.referencedFiles = referencedFiles;
      if (stale !== undefined) data.stale = stale;
      if (staleReason !== undefined) data.staleReason = staleReason;
      if (updatedByThreadId !== undefined) data.updatedByThreadId = updatedByThreadId;

      // Reset stale/lastVerifiedAt on content update
      if (contents !== undefined) {
        data.contents = contents;
        data.stale = false;
        data.lastVerifiedAt = new Date();
      }

      const card = await prisma.ankiCard.update({
        where: { id: cardId },
        data,
      });

      res.json(card);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete card
  r.delete("/:cardId", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { projectId, cardId } = req.params as any;

      const existing = await prisma.ankiCard.findFirst({
        where: {
          id: cardId,
          project: { id: projectId, userId },
        },
      });
      if (!existing) return res.status(404).json({ error: "Card not found" });

      await prisma.ankiCard.delete({ where: { id: cardId } });

      res.status(204).end();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return r;
}
