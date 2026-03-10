import { Router } from "express";
import prisma from "../db/prisma.js";

export function pluginsRouter(): Router {
  const router = Router();

  // List all available plugins (marketplace)
  router.get("/", async (_req, res) => {
    try {
      const userId = (_req as any).user?.id;
      const plugins = await prisma.plugin.findMany({
        orderBy: [{ category: "asc" }, { name: "asc" }],
        include: {
          _count: { select: { installedBy: true } },
          ...(userId
            ? {
                installedBy: {
                  where: { userId },
                  select: { id: true, config: true, createdAt: true },
                },
              }
            : {}),
        },
      });

      const result = plugins.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        description: p.description,
        author: p.author,
        category: p.category,
        icon: p.icon,
        tags: p.tags,
        version: p.version,
        builtIn: p.builtIn,
        verified: p.verified,
        homepage: p.homepage,
        sourceType: p.sourceType,
        installCount: p._count.installedBy,
        installed: userId ? p.installedBy.length > 0 : false,
        installedAt: userId && p.installedBy.length > 0 ? p.installedBy[0].createdAt : null,
      }));

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get single plugin with full details
  router.get("/:id", async (req, res) => {
    try {
      const plugin = await prisma.plugin.findUnique({
        where: { id: req.params.id },
        include: { _count: { select: { installedBy: true } } },
      });
      if (!plugin) return res.status(404).json({ error: "Plugin not found" });
      res.json({ ...plugin, installCount: plugin._count.installedBy });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get user's installed plugins
  router.get("/user/installed", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.json([]);

      const installed = await prisma.installedPlugin.findMany({
        where: { userId },
        include: { plugin: true },
        orderBy: { createdAt: "desc" },
      });

      res.json(
        installed.map((ip) => ({
          ...ip.plugin,
          installedAt: ip.createdAt,
          config: ip.config,
          installed: true,
        }))
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
