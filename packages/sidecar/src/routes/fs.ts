import { Router } from "express";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const router = Router();

// GET /fs/read?path=...
router.get("/fs/read", async (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath) {
    res.status(400).json({ error: "path query parameter is required" });
    return;
  }
  try {
    const content = await readFile(filePath, "utf-8");
    res.json({ content });
  } catch (err: any) {
    if (err.code === "ENOENT") {
      res.status(404).json({ error: "File not found" });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// POST /fs/write { path, content }
router.post("/fs/write", async (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath || content === undefined || content === null) {
    res
      .status(400)
      .json({ error: "path and content are required" });
    return;
  }
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf-8");
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
