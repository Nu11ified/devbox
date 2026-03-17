import { Router, type Router as RouterType } from "express";
import prisma from "../db/prisma.js";
import { Prisma } from "@prisma/client";
import { requireUser, getUserId } from "../auth/require-user.js";

export const archiveRouter: RouterType = Router();

interface ArchiveSearchResult {
  id: string;
  /** "issue" or "thread" */
  kind: "issue" | "thread";
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
archiveRouter.get("/", requireUser(), async (req, res) => {
  const userId = getUserId(req);
  const query = (req.query.q as string) || "";
  const projectId = req.query.projectId as string | undefined;
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || "20"), 10)));
  const offset = (page - 1) * limit;

  try {
    if (!query.trim()) {
      // No search query — return all archived issues AND archived threads, newest first
      const issueWhere: Record<string, unknown> = { status: "archived", createdByUserId: userId };
      if (projectId) issueWhere.projectId = projectId;

      const threadWhere: Record<string, unknown> = { archivedAt: { not: null }, userId };
      if (projectId) threadWhere.projectId = projectId;

      const [issues, threads, issueCount, threadCount] = await Promise.all([
        prisma.issue.findMany({
          where: issueWhere,
          orderBy: { archivedAt: "desc" },
          take: limit,
          include: {
            project: { select: { id: true, name: true } },
            thread: { select: { id: true } },
          },
        }),
        prisma.thread.findMany({
          where: threadWhere,
          orderBy: { archivedAt: "desc" },
          take: limit,
          include: {
            project: { select: { id: true, name: true } },
          },
        }),
        prisma.issue.count({ where: issueWhere }),
        prisma.thread.count({ where: threadWhere }),
      ]);

      const issueResults: ArchiveSearchResult[] = issues.map((i) => ({
        id: i.id,
        kind: "issue" as const,
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

      const threadResults: ArchiveSearchResult[] = threads.map((t) => ({
        id: t.id,
        kind: "thread" as const,
        identifier: "",
        title: t.title,
        body: "",
        status: t.status ?? "archived",
        priority: 0,
        repo: "",
        archivedAt: t.archivedAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        prUrl: null,
        projectId: t.projectId,
        projectName: (t as any).project?.name ?? null,
        threadId: t.id,
        snippet: null,
      }));

      // Merge and sort by archivedAt descending
      const results = [...issueResults, ...threadResults]
        .sort((a, b) => {
          const da = a.archivedAt ? new Date(a.archivedAt).getTime() : 0;
          const db = b.archivedAt ? new Date(b.archivedAt).getTime() : 0;
          return db - da;
        })
        .slice(offset, offset + limit);

      res.json({ results, total: issueCount + threadCount, page, limit });
      return;
    }

    // Full-text search across archived issues AND archived threads
    // ts_headline uses ** delimiters instead of HTML tags for safety

    // 1. Search archived issues (and their linked thread content)
    const issueResults = await prisma.$queryRaw<Array<{
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
        AND i.created_by_user_id = ${userId}::text
        AND (
          to_tsvector('english', COALESCE(i.title, '') || ' ' || COALESCE(i.body, ''))
            @@ plainto_tsquery('english', ${query})
          OR to_tsvector('english', COALESCE(t.content, ''))
            @@ plainto_tsquery('english', ${query})
        )
        ${projectId ? Prisma.sql`AND i.project_id = ${projectId}::uuid` : Prisma.empty}
      ORDER BY i.id, i.archived_at DESC
      LIMIT ${limit}
    `;

    // 2. Search archived threads directly (threads archived independently of issues)
    const threadResults = await prisma.$queryRaw<Array<{
      id: string;
      title: string;
      status: string;
      archived_at: Date | null;
      created_at: Date;
      updated_at: Date;
      project_id: string | null;
      project_name: string | null;
      snippet: string | null;
    }>>`
      SELECT DISTINCT ON (th.id)
        th.id,
        th.title,
        th.status,
        th.archived_at,
        th.created_at,
        th.updated_at,
        th.project_id,
        p.name as project_name,
        COALESCE(
          ts_headline('english', COALESCE(t.content, ''),
            plainto_tsquery('english', ${query}),
            'MaxWords=30, MinWords=15, HighlightAll=false, StartSel=**, StopSel=**'),
          ''
        ) as snippet
      FROM threads th
      LEFT JOIN projects p ON p.id = th.project_id
      LEFT JOIN thread_turns t ON t.thread_id = th.id
      WHERE th.archived_at IS NOT NULL
        AND th.user_id = ${userId}::text
        AND (
          to_tsvector('english', COALESCE(th.title, ''))
            @@ plainto_tsquery('english', ${query})
          OR to_tsvector('english', COALESCE(t.content, ''))
            @@ plainto_tsquery('english', ${query})
        )
        ${projectId ? Prisma.sql`AND th.project_id = ${projectId}::uuid` : Prisma.empty}
      ORDER BY th.id, th.archived_at DESC
      LIMIT ${limit}
    `;

    const mappedIssues: ArchiveSearchResult[] = issueResults.map((r) => ({
      id: r.id,
      kind: "issue" as const,
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

    const mappedThreads: ArchiveSearchResult[] = threadResults.map((r) => ({
      id: r.id,
      kind: "thread" as const,
      identifier: "",
      title: r.title,
      body: "",
      status: r.status ?? "archived",
      priority: 0,
      repo: "",
      archivedAt: r.archived_at?.toISOString() ?? null,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
      prUrl: null,
      projectId: r.project_id,
      projectName: r.project_name,
      threadId: r.id,
      snippet: r.snippet,
    }));

    // Merge, sort by archivedAt, and paginate
    const merged = [...mappedIssues, ...mappedThreads]
      .sort((a, b) => {
        const da = a.archivedAt ? new Date(a.archivedAt).getTime() : 0;
        const db = b.archivedAt ? new Date(b.archivedAt).getTime() : 0;
        return db - da;
      })
      .slice(0, limit);

    res.json({ results: merged, page, limit });
  } catch (err) {
    console.error("[archive] search error:", err);
    res.status(500).json({ error: "Archive search failed" });
  }
});
