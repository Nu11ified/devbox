import { Router, type Router as RouterType } from "express";
import prisma from "../db/prisma.js";
import { Prisma } from "@prisma/client";

export const archiveRouter: RouterType = Router();

interface ArchiveSearchResult {
  id: string;
  identifier: string;
  title: string;
  body: string;
  status: string;
  priority: number;
  repo: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  prUrl: string | null;
  projectId: string | null;
  projectName: string | null;
  threadId: string | null;
  snippet: string | null;
}

// GET /api/archive — search archived issues (and optionally thread content)
archiveRouter.get("/", async (req, res) => {
  const query = (req.query.q as string) || "";
  const projectId = req.query.projectId as string | undefined;
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "20"), 10)));
  const offset = (page - 1) * limit;

  try {
    if (!query.trim()) {
      // No search query — return all archived issues, newest first
      const where: Record<string, unknown> = { status: "archived" };
      if (projectId) where.projectId = projectId;

      const [issues, total] = await Promise.all([
        prisma.issue.findMany({
          where,
          orderBy: { archivedAt: "desc" },
          skip: offset,
          take: limit,
          include: {
            project: { select: { id: true, name: true } },
            thread: { select: { id: true } },
          },
        }),
        prisma.issue.count({ where }),
      ]);

      const results: ArchiveSearchResult[] = issues.map((i) => ({
        id: i.id,
        identifier: i.identifier,
        title: i.title,
        body: i.body,
        status: i.status,
        priority: i.priority,
        repo: i.repo,
        archivedAt: i.archivedAt?.toISOString() ?? null,
        createdAt: i.createdAt.toISOString(),
        updatedAt: i.updatedAt.toISOString(),
        prUrl: i.prUrl,
        projectId: i.projectId,
        projectName: (i as any).project?.name ?? null,
        threadId: (i as any).thread?.id ?? null,
        snippet: null,
      }));

      res.json({ results, total, page, limit });
      return;
    }

    // Full-text search across issue titles/bodies and thread turn content
    // ts_headline uses ** delimiters instead of HTML tags for safety
    const results = await prisma.$queryRaw<Array<{
      id: string;
      identifier: string;
      title: string;
      body: string;
      status: string;
      priority: number;
      repo: string;
      archived_at: Date | null;
      created_at: Date;
      updated_at: Date;
      pr_url: string | null;
      project_id: string | null;
      project_name: string | null;
      thread_id: string | null;
      snippet: string | null;
    }>>`
      SELECT DISTINCT ON (i.id)
        i.id,
        i.identifier,
        i.title,
        i.body,
        i.status,
        i.priority,
        i.repo,
        i.archived_at,
        i.created_at,
        i.updated_at,
        i.pr_url,
        i.project_id,
        p.name as project_name,
        th.id as thread_id,
        COALESCE(
          ts_headline('english', COALESCE(t.content, ''),
            plainto_tsquery('english', ${query}),
            'MaxWords=30, MinWords=15, HighlightAll=false, StartSel=**, StopSel=**'),
          ''
        ) as snippet
      FROM issues i
      LEFT JOIN projects p ON p.id = i.project_id
      LEFT JOIN threads th ON th.issue_id = i.id
      LEFT JOIN thread_turns t ON t.thread_id = th.id
      WHERE i.status = 'archived'
        AND (
          to_tsvector('english', COALESCE(i.title, '') || ' ' || COALESCE(i.body, ''))
            @@ plainto_tsquery('english', ${query})
          OR to_tsvector('english', COALESCE(t.content, ''))
            @@ plainto_tsquery('english', ${query})
        )
        ${projectId ? Prisma.sql`AND i.project_id = ${projectId}::uuid` : Prisma.empty}
      ORDER BY i.id, i.archived_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const mapped: ArchiveSearchResult[] = results.map((r) => ({
      id: r.id,
      identifier: r.identifier,
      title: r.title,
      body: r.body,
      status: r.status,
      priority: r.priority,
      repo: r.repo,
      archivedAt: r.archived_at?.toISOString() ?? null,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
      prUrl: r.pr_url,
      projectId: r.project_id,
      projectName: r.project_name,
      threadId: r.thread_id,
      snippet: r.snippet,
    }));

    res.json({ results: mapped, page, limit });
  } catch (err) {
    console.error("[archive] search error:", err);
    res.status(500).json({ error: "Archive search failed" });
  }
});
