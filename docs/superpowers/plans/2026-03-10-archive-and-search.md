# Archive & Search Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-archive completed issues, add browsable archive views with full-text search, and inject relevant past thread context into autonomous agent prompts.

**Architecture:** New `archived` status in the issue lifecycle. Server-side cron job archives done/cancelled issues after 24h. Global `/archive` page and per-project sidebar section search archived issues/threads via PostgreSQL GIN indexes. Dispatcher queries archived thread turns before building autonomous prompts.

**Tech Stack:** Prisma (schema + raw SQL for full-text), Express API, Next.js App Router, PostgreSQL GIN indexes

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/server/src/orchestrator/archive-job.ts` | Auto-archive cron (runs every 30 min, archives done/cancelled issues older than 24h) |
| `packages/server/src/orchestrator/context-search.ts` | Full-text search of past thread turns for agent context injection |
| `packages/server/src/api/archive.ts` | `GET /api/archive` endpoint — search archived issues + thread content |
| `packages/ui/src/app/archive/page.tsx` | Global archive page with search, filters, pagination |

### Modified Files
| File | Changes |
|------|---------|
| `packages/shared/src/types.ts:110` | Add `"archived"` to `IssueStatus` union |
| `packages/server/prisma/schema.prisma:148-185` | Add `archivedAt` field to Issue model |
| `packages/server/src/db/queries.ts:168-187` | Exclude archived from `findAllIssues` by default; add `archivedAt` to `updateIssue` fieldMap |
| `packages/server/src/index.ts:100-104` | Start archive job, run GIN index creation SQL on startup |
| `packages/server/src/orchestrator/dispatcher.ts:179-180` | Inject past context into autonomous prompt |
| `packages/ui/src/app/board/page.tsx:493-519` | Add Archive button on done/cancelled cards |
| `packages/ui/src/components/top-bar.tsx:22-27` | Add Archive nav link |
| `packages/ui/src/components/project-sidebar.tsx:30-36` | Add `archived` + `cancelled` colors to `issueStatusColor`; add per-project archive section |
| `packages/ui/src/lib/api.ts:91-120,327-339` | Add `archivedAt` to `IssueItem`; add `searchArchive()` method |

---

## Chunk 1: Data Model & Backend Foundation

### Task 1: Add `archived` to IssueStatus type

**Files:**
- Modify: `packages/shared/src/types.ts:110`

- [ ] **Step 1: Add archived to the union type**

In `packages/shared/src/types.ts`, line 110, change:

```typescript
export type IssueStatus = "open" | "queued" | "in_progress" | "review" | "done" | "cancelled";
```

to:

```typescript
export type IssueStatus = "open" | "queued" | "in_progress" | "review" | "done" | "cancelled" | "archived";
```

- [ ] **Step 2: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add 'archived' to IssueStatus union type"
```

---

### Task 2: Add `archivedAt` field to Prisma schema

**Files:**
- Modify: `packages/server/prisma/schema.prisma:148-185`

- [ ] **Step 1: Add archivedAt field to Issue model**

In `packages/server/prisma/schema.prisma`, after line 171 (`prUrl`), add:

```prisma
  archivedAt       DateTime? @map("archived_at") @db.Timestamptz
```

The Issue model's fields section (after `prUrl`) should look like:

```prisma
  prUrl            String?   @map("pr_url")
  archivedAt       DateTime? @map("archived_at") @db.Timestamptz
  createdByUserId  String?   @map("created_by_user_id")
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/prisma/schema.prisma
git commit -m "feat(schema): add archivedAt field to Issue model"
```

Note: `prisma db push` runs automatically on server startup via `runMigration()` in `packages/server/src/db/migrate.ts:69`.

---

### Task 3: Update `updateIssue` to support `archivedAt` and auto-clear on un-archive

**Files:**
- Modify: `packages/server/src/db/queries.ts:204-250`

- [ ] **Step 1: Add archivedAt to updateIssue type signature and fieldMap**

In `packages/server/src/db/queries.ts`, line 206, change the `fields` type to include `archivedAt`:

```typescript
export async function updateIssue(
  id: string,
  fields: Partial<CreateIssueInput & { status: string; runId: string; retryCount: number; lastError: string | null; prUrl: string | null; archivedAt: Date | null }>
) {
```

Add to the `fieldMap` object (after line 226 `prUrl: "prUrl",`):

```typescript
    archivedAt: "archivedAt",
```

- [ ] **Step 2: Add auto-clear archivedAt when status moves away from archived**

After the fieldMap loop (after line 235), add logic to auto-set/clear `archivedAt`:

```typescript
  // Auto-manage archivedAt based on status transitions
  if (data.status === "archived" && !("archivedAt" in fields)) {
    data.archivedAt = new Date();
  } else if (data.status && data.status !== "archived" && !("archivedAt" in fields)) {
    data.archivedAt = null;
  }
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/db/queries.ts
git commit -m "feat(queries): add archivedAt to updateIssue with auto-manage logic"
```

---

### Task 4: Exclude archived issues from `findAllIssues` by default

**Files:**
- Modify: `packages/server/src/db/queries.ts:168-187`

- [ ] **Step 1: Add default archived exclusion**

In `packages/server/src/db/queries.ts`, modify `findAllIssues` (lines 168-187). After building the `where` object, add default exclusion:

```typescript
export async function findAllIssues(filters?: {
  status?: string;
  repo?: string;
  priority?: number;
}) {
  const where: Record<string, unknown> = {};
  if (filters?.status) {
    where.status = filters.status;
  } else {
    // Exclude archived issues by default when no status filter is provided
    where.status = { notIn: ["archived"] };
  }
  if (filters?.repo) where.repo = filters.repo;
  if (filters?.priority !== undefined) where.priority = filters.priority;

  return prisma.issue.findMany({
    where,
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    include: {
      thread: {
        select: { id: true, status: true, worktreeBranch: true },
      },
    },
  });
}
```

- [ ] **Step 2: Verify board still works**

The board calls `api.listIssues()` with no status filter (line 69 of `board/page.tsx`), so it will now automatically exclude archived issues.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/db/queries.ts
git commit -m "feat(queries): exclude archived issues from findAllIssues by default"
```

---

### Task 5: Create GIN index creation SQL in server startup

**Files:**
- Modify: `packages/server/src/index.ts:84-88`

- [ ] **Step 1: Add GIN index creation after migrations**

In `packages/server/src/index.ts`, add the prisma import at the top (after the other imports):

```typescript
import prisma from "./db/prisma.js";
```

After line 87 (`await seedPlugins();`), add:

```typescript
    // Create full-text search GIN indexes (idempotent)
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS idx_thread_turns_search
          ON thread_turns USING GIN (to_tsvector('english', COALESCE(content, '')));
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS idx_issues_title_search
          ON issues USING GIN (to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(body, '')));
      `);
      console.log("Full-text search indexes ready");
    } catch (err) {
      console.warn("GIN index creation skipped (may already exist):", (err as Error).message);
    }
```

Uses the shared `prisma` instance from `packages/server/src/db/prisma.ts` — no need for a separate PrismaClient.

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/index.ts
git commit -m "feat(server): create full-text search GIN indexes on startup"
```

---

### Task 6: Create auto-archive job

**Files:**
- Create: `packages/server/src/orchestrator/archive-job.ts`

- [ ] **Step 1: Write the archive job**

Create `packages/server/src/orchestrator/archive-job.ts`:

```typescript
import prisma from "../db/prisma.js";

const ARCHIVE_DELAY_MS = 24 * 60 * 60 * 1000; // 24 hours
const ARCHIVE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Archive issues that have been done or cancelled for more than 24 hours.
 * Returns the count of archived issues.
 */
export async function archiveStaleIssues(): Promise<number> {
  const cutoff = new Date(Date.now() - ARCHIVE_DELAY_MS);
  const result = await prisma.issue.updateMany({
    where: {
      status: { in: ["done", "cancelled"] },
      updatedAt: { lt: cutoff },
    },
    data: {
      status: "archived",
      archivedAt: new Date(),
    },
  });
  return result.count;
}

/**
 * Starts the archive job on a 30-minute interval.
 * Returns a cleanup function to stop the interval.
 */
export function startArchiveJob(): { stop: () => void } {
  let timer: NodeJS.Timeout | null = null;

  async function run() {
    try {
      const count = await archiveStaleIssues();
      if (count > 0) {
        console.log(`[archive-job] archived ${count} stale issues`);
      }
    } catch (err) {
      console.error("[archive-job] error:", err);
    }
  }

  // Run immediately on start, then every 30 minutes
  run();
  timer = setInterval(run, ARCHIVE_INTERVAL_MS);

  return {
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      console.log("[archive-job] stopped");
    },
  };
}
```

- [ ] **Step 2: Wire up the archive job in server startup**

In `packages/server/src/index.ts`, add the import at the top (after line 18):

```typescript
import { startArchiveJob } from "./orchestrator/archive-job.js";
```

After line 104 (`syncJob.start();`), add:

```typescript
    const archiveJob = startArchiveJob();
```

In the SIGTERM handler (line 106-110), add `archiveJob.stop();`:

```typescript
    process.on("SIGTERM", () => {
      orchestrator.stop();
      syncJob.stop();
      archiveJob.stop();
      server.close();
    });
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/orchestrator/archive-job.ts packages/server/src/index.ts
git commit -m "feat(server): add auto-archive job for stale done/cancelled issues"
```

---

## Chunk 2: Archive Search API

### Task 7: Create archive search endpoint

**Files:**
- Create: `packages/server/src/api/archive.ts`

- [ ] **Step 1: Write the archive search API**

Create `packages/server/src/api/archive.ts`:

```typescript
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
    // ts_headline returns plain text with <b> tags — we strip HTML server-side
    // to prevent any XSS risk on the client
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
```

Note: `ts_headline` is configured with `StartSel=**, StopSel=**` to use markdown-style `**bold**` delimiters instead of HTML `<b>` tags. This makes the snippet safe to render as plain text on the client — highlighted words appear between `**` markers.

- [ ] **Step 2: Register the archive route in the server**

In `packages/server/src/index.ts`, add the import at the top (after the other API imports):

```typescript
import { archiveRouter } from "./api/archive.js";
```

After line 72 (`app.use("/api/projects", projectsRouter());`), add:

```typescript
  app.use("/api/archive", archiveRouter);
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/api/archive.ts packages/server/src/index.ts
git commit -m "feat(api): add GET /api/archive endpoint with full-text search"
```

---

### Task 8: Create context search for agent injection

**Files:**
- Create: `packages/server/src/orchestrator/context-search.ts`

- [ ] **Step 1: Write the context search module**

Create `packages/server/src/orchestrator/context-search.ts`:

```typescript
import prisma from "../db/prisma.js";
import { Prisma } from "@prisma/client";

// Common words to strip from search terms
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
  "as", "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "here", "there", "when", "where", "why", "how", "all", "both",
  "each", "few", "more", "most", "other", "some", "such", "no", "nor",
  "not", "only", "own", "same", "so", "than", "too", "very", "just",
  "don", "now", "and", "but", "or", "if", "it", "its", "this", "that",
  "add", "fix", "update", "change", "make", "implement", "create",
]);

const MAX_CONTEXT_CHARS = 8000;

/**
 * Extract meaningful search terms from issue text.
 * Keeps file paths, component names, error patterns, and technical terms.
 */
function extractSearchTerms(text: string): string | null {
  const words = text
    .replace(/[^\w\s/.\-_]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()))
    .slice(0, 15); // Cap to avoid overly broad queries

  return words.length > 0 ? words.join(" ") : null;
}

/**
 * Search archived thread turns for context relevant to a new issue.
 * Returns a formatted "Relevant Past Work" section, or null if nothing found.
 */
export async function findRelevantContext(
  issueTitle: string,
  issueBody: string,
  projectId?: string | null
): Promise<string | null> {
  const searchTerms = extractSearchTerms(issueTitle + " " + issueBody);
  if (!searchTerms) return null;

  try {
    const results = await prisma.$queryRaw<Array<{
      identifier: string;
      issue_title: string;
      snippet: string;
      rank: number;
    }>>`
      SELECT
        i.identifier,
        i.title as issue_title,
        ts_headline('english', COALESCE(t.content, ''),
          plainto_tsquery('english', ${searchTerms}),
          'MaxWords=50, MinWords=20') as snippet,
        ts_rank(to_tsvector('english', COALESCE(t.content, '')),
          plainto_tsquery('english', ${searchTerms})) as rank
      FROM thread_turns t
      JOIN threads th ON th.id = t.thread_id
      JOIN issues i ON i.id = th.issue_id
      WHERE i.status = 'archived'
        AND t.role = 'assistant'
        AND to_tsvector('english', COALESCE(t.content, ''))
          @@ plainto_tsquery('english', ${searchTerms})
        ${projectId ? Prisma.sql`AND i.project_id = ${projectId}::uuid` : Prisma.empty}
      ORDER BY rank DESC
      LIMIT 3
    `;

    if (!results.length) return null;

    let context = "## Relevant Past Work\n\n";
    context += "The following snippets from past completed issues may be relevant. Use only if helpful.\n\n";
    for (const r of results) {
      context += `### ${r.identifier}: ${r.issue_title}\n${r.snippet}\n\n`;
    }

    return context.length > MAX_CONTEXT_CHARS
      ? context.slice(0, MAX_CONTEXT_CHARS) + "\n..."
      : context;
  } catch (err) {
    console.error("[context-search] error:", err);
    return null;
  }
}
```

- [ ] **Step 2: Inject context into the dispatcher**

In `packages/server/src/orchestrator/dispatcher.ts`, add the import at the top (after line 6):

```typescript
import { findRelevantContext } from "./context-search.js";
```

Then in the `dispatchIssue` function, replace lines 179-180:

```typescript
  // Send autonomous prompt
  const prompt = buildAutonomousPrompt(issue);
```

with:

```typescript
  // Build autonomous prompt with past context injection
  let prompt = buildAutonomousPrompt(issue);
  const pastContext = await findRelevantContext(issue.title, issue.body, issue.projectId);
  if (pastContext) {
    prompt += "\n\n" + pastContext;
  }
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/orchestrator/context-search.ts packages/server/src/orchestrator/dispatcher.ts
git commit -m "feat(dispatcher): inject relevant past thread context into autonomous prompts"
```

---

## Chunk 3: Board UI Changes

### Task 9: Add Archive button to board cards

**Files:**
- Modify: `packages/ui/src/app/board/page.tsx:493-519`
- Modify: `packages/ui/src/app/board/page.tsx:1-16` (imports)

- [ ] **Step 1: Add Archive icon import**

In `packages/ui/src/app/board/page.tsx`, line 5, add `Archive` to the lucide-react import:

```typescript
import {
  PlusCircle,
  ExternalLink,
  GitPullRequest,
  CircleDot,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  GitBranch,
  Zap,
  Archive,
} from "lucide-react";
```

- [ ] **Step 2: Add Archive button to IssueCard**

In `packages/ui/src/app/board/page.tsx`, in the IssueCard component, after the "Done" button (line 513) and before the cancel button (line 515), add the Archive button:

Replace lines 510-519:
```typescript
            {issue.status === "review" && (
              <Button size="sm" variant="outline" className="h-5 text-[10px] px-1.5 border-zinc-700/40 text-zinc-400 hover:text-zinc-300" onClick={() => onTransition(issue.id, "done")}>
                Done
              </Button>
            )}
            {issue.status !== "done" && issue.status !== "cancelled" && (
              <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5 text-red-500/70 hover:text-red-400" onClick={() => onTransition(issue.id, "cancelled")}>
                <XCircle className="h-3 w-3" />
              </Button>
            )}
```

with:

```typescript
            {issue.status === "review" && (
              <Button size="sm" variant="outline" className="h-5 text-[10px] px-1.5 border-zinc-700/40 text-zinc-400 hover:text-zinc-300" onClick={() => onTransition(issue.id, "done")}>
                Done
              </Button>
            )}
            {(issue.status === "done" || issue.status === "cancelled") && (
              <Button
                size="sm"
                variant="outline"
                className="h-5 text-[10px] px-1.5 border-zinc-600/40 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500/40"
                onClick={() => onTransition(issue.id, "archived")}
              >
                <Archive className="h-2.5 w-2.5 mr-0.5" />
                Archive
              </Button>
            )}
            {issue.status !== "done" && issue.status !== "cancelled" && (
              <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5 text-red-500/70 hover:text-red-400" onClick={() => onTransition(issue.id, "cancelled")}>
                <XCircle className="h-3 w-3" />
              </Button>
            )}
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/app/board/page.tsx
git commit -m "feat(board): add Archive button on done/cancelled issue cards"
```

---

### Task 10: Add `archivedAt` to UI API types

**Files:**
- Modify: `packages/ui/src/lib/api.ts:91-120`

- [ ] **Step 1: Add archivedAt to IssueItem interface**

In `packages/ui/src/lib/api.ts`, after line 112 (`prUrl?: string | null;`), add:

```typescript
  archivedAt?: string | null;
```

- [ ] **Step 2: Add archive search types and API method**

After the `IssueItem` interface (after line 120), add the archive search types:

```typescript
export interface ArchiveSearchResult {
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

export interface ArchiveSearchResponse {
  results: ArchiveSearchResult[];
  total?: number;
  page: number;
  limit: number;
}
```

In the `PatchworkAPI` class, after the `dispatchIssue` method (after line 365), add:

```typescript
  // Archive
  async searchArchive(params?: {
    q?: string;
    projectId?: string;
    page?: number;
    limit?: number;
  }): Promise<ArchiveSearchResponse> {
    const qs = new URLSearchParams();
    if (params?.q) qs.set("q", params.q);
    if (params?.projectId) qs.set("projectId", params.projectId);
    if (params?.page) qs.set("page", String(params.page));
    if (params?.limit) qs.set("limit", String(params.limit));
    const query = qs.toString();
    return request<ArchiveSearchResponse>(`/api/archive${query ? `?${query}` : ""}`);
  }
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/lib/api.ts
git commit -m "feat(api-client): add archive search types and API method"
```

---

## Chunk 4: Archive Page & Navigation

### Task 11: Add Archive link to TopBar

**Files:**
- Modify: `packages/ui/src/components/top-bar.tsx:1-27`

- [ ] **Step 1: Add Archive icon import and nav link**

In `packages/ui/src/components/top-bar.tsx`, add `Archive` to the lucide-react import (line 5):

```typescript
import {
  LayoutGrid,
  FolderOpen,
  Puzzle,
  Settings,
  Search,
  LogOut,
  Github,
  ChevronDown,
  Menu,
  X,
  Archive,
} from "lucide-react";
```

Add the Archive link to `navLinks` (line 22-27), between Projects and Plugins:

```typescript
const navLinks = [
  { href: "/board", label: "Board", icon: LayoutGrid },
  { href: "/projects", label: "Projects", icon: FolderOpen },
  { href: "/archive", label: "Archive", icon: Archive },
  { href: "/plugins", label: "Plugins", icon: Puzzle },
  { href: "/settings", label: "Settings", icon: Settings },
];
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/top-bar.tsx
git commit -m "feat(topbar): add Archive link to navigation"
```

---

### Task 12: Create global archive page

**Files:**
- Create: `packages/ui/src/app/archive/page.tsx`

- [ ] **Step 1: Create the archive page**

Create `packages/ui/src/app/archive/page.tsx`.

The snippet field uses `**word**` markdown-style delimiters (set via `StartSel=**, StopSel=**` in the SQL query). Render snippets as plain text — the `**` markers indicate matches but are safe to display directly.

```typescript
"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, Archive, GitPullRequest } from "lucide-react";
import { api, type ArchiveSearchResult, type ArchiveSearchResponse, type ProjectItem } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const statusColors: Record<string, string> = {
  done: "bg-emerald-900/30 text-emerald-400 border-emerald-700/30",
  cancelled: "bg-red-900/30 text-red-400 border-red-700/30",
  archived: "bg-zinc-800/50 text-zinc-400 border-zinc-700/30",
};

export default function ArchivePage() {
  const router = useRouter();
  const { data: projects } = useApi(() => api.listProjects(), []);

  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [searchResults, setSearchResults] = useState<ArchiveSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Load initial archive on mount
  const { data: initialData, loading: initialLoading } = useApi(
    () => api.searchArchive({ page: 1, limit: 20 }),
    []
  );

  const doSearch = useCallback(async (searchPage = 1) => {
    setLoading(true);
    setHasSearched(true);
    try {
      const result = await api.searchArchive({
        q: query || undefined,
        projectId: projectFilter !== "all" ? projectFilter : undefined,
        page: searchPage,
        limit: 20,
      });
      setSearchResults(result);
      setPage(searchPage);
    } catch (err) {
      console.error("Archive search failed:", err);
    } finally {
      setLoading(false);
    }
  }, [query, projectFilter]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    doSearch(1);
  };

  const data = hasSearched ? searchResults : initialData;
  const results = data?.results ?? [];
  const isLoading = hasSearched ? loading : initialLoading;

  function handleResultClick(result: ArchiveSearchResult) {
    if (result.projectId && result.threadId) {
      router.push(`/projects/${result.projectId}/threads/${result.threadId}`);
    } else if (result.projectId) {
      router.push(`/projects/${result.projectId}`);
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Archive className="h-6 w-6 text-zinc-400" />
          Archive
        </h1>
        <p className="text-sm text-muted-foreground/70 mt-0.5">
          Search completed issues and past thread transcripts
        </p>
      </div>

      {/* Search bar */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search archived issues and threads..."
            className="pl-9 bg-zinc-900/50 border-zinc-800/60"
          />
        </div>
        <Select value={projectFilter} onValueChange={(v) => setProjectFilter(v)}>
          <SelectTrigger className="w-[180px] bg-zinc-900/50 border-zinc-800/60">
            <SelectValue placeholder="All Projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {(projects ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" size="sm" disabled={isLoading}>
          Search
        </Button>
      </form>

      {/* Results */}
      {isLoading && (
        <div className="py-12 text-center text-muted-foreground text-sm">
          Searching...
        </div>
      )}

      {!isLoading && results.length === 0 && (
        <div className="py-12 text-center text-muted-foreground/60 text-sm">
          {hasSearched ? "No results found" : "No archived issues yet"}
        </div>
      )}

      {!isLoading && results.length > 0 && (
        <div className="space-y-2">
          {results.map((result) => (
            <div
              key={result.id}
              className="border border-zinc-800/40 rounded-lg p-3 hover:border-zinc-700/60 hover:bg-zinc-900/30 transition-all cursor-pointer"
              onClick={() => handleResultClick(result)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-zinc-500">
                      {result.identifier}
                    </span>
                    <span className="text-sm font-medium text-zinc-200 truncate">
                      {result.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded-full border",
                      statusColors[result.status] ?? statusColors.archived
                    )}>
                      {result.status}
                    </span>
                    {result.projectName && (
                      <span className="text-[11px] text-zinc-500">
                        {result.projectName}
                      </span>
                    )}
                    {result.archivedAt && (
                      <span className="text-[11px] text-zinc-600">
                        {timeAgo(result.archivedAt)}
                      </span>
                    )}
                    {result.prUrl && (
                      <a
                        href={result.prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] text-purple-400 hover:text-purple-300"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <GitPullRequest className="w-3 h-3" />
                        PR
                      </a>
                    )}
                  </div>
                </div>
              </div>
              {result.snippet && result.snippet.trim() && (
                <p className="mt-2 text-xs text-zinc-500 leading-relaxed border-t border-zinc-800/30 pt-2 line-clamp-3">
                  {result.snippet}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && results.length > 0 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => doSearch(page - 1)}
            className="text-xs"
          >
            Previous
          </Button>
          <span className="text-xs text-zinc-500">Page {page}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={results.length < 20}
            onClick={() => doSearch(page + 1)}
            className="text-xs"
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify Next.js API proxy covers `/api/archive`**

The catch-all API proxy at `packages/ui/src/app/api/[...path]/route.ts` handles all `/api/*` requests and forwards them to the backend server. Since `/api/archive` matches this pattern, no proxy changes are needed.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/app/archive/page.tsx
git commit -m "feat(ui): add global archive page with full-text search"
```

---

## Chunk 5: Project Sidebar & Final Polish

### Task 13: Add archived/cancelled colors to project sidebar

**Files:**
- Modify: `packages/ui/src/components/project-sidebar.tsx:30-36`

- [ ] **Step 1: Add missing status colors**

In `packages/ui/src/components/project-sidebar.tsx`, update the `issueStatusColor` map (lines 30-36):

```typescript
const issueStatusColor: Record<string, string> = {
  open: "text-zinc-400",
  queued: "text-blue-400",
  in_progress: "text-amber-400",
  review: "text-violet-400",
  done: "text-emerald-400",
  cancelled: "text-red-400",
  archived: "text-zinc-600",
};
```

- [ ] **Step 2: Add per-project archive section**

In `packages/ui/src/components/project-sidebar.tsx`, add the Archive import at the top (after the existing lucide imports on line 6):

```typescript
import { ArrowLeft, Plus, GitBranch, CircleDot, Archive } from "lucide-react";
```

Add state and imports for the archive section. At the top of the `ProjectSidebar` component (after line 51 `const pathname = usePathname();`), add:

```typescript
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveItems, setArchiveItems] = useState<Array<{
    id: string;
    identifier: string;
    title: string;
    archivedAt: string | null;
  }>>([]);
  const [archiveLoading, setArchiveLoading] = useState(false);
```

Add a `useEffect` to fetch archive items when the section is opened. After the existing `useEffect` for `fetchProject` (after line 78):

```typescript
  useEffect(() => {
    if (!archiveOpen) return;
    let cancelled = false;
    setArchiveLoading(true);
    api.searchArchive({ projectId, limit: 10 })
      .then((res) => {
        if (!cancelled) {
          setArchiveItems(res.results.map((r) => ({
            id: r.id,
            identifier: r.identifier,
            title: r.title,
            archivedAt: r.archivedAt,
          })));
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setArchiveLoading(false); });
    return () => { cancelled = true; };
  }, [archiveOpen, projectId]);
```

After the Issues section closing tag (after line 264 `)}`) but before the closing `</div>` of the scrollable area (line 265), add:

```typescript
          {/* ── Archive Section ───────────────────────────────── */}
          <div className="mt-3">
            <button
              onClick={() => setArchiveOpen(!archiveOpen)}
              className="flex items-center gap-1.5 px-2 py-1.5 w-full text-left hover:bg-zinc-800/30 rounded transition-colors"
            >
              <Archive className="h-3 w-3 text-zinc-600" />
              <span className="text-[10px] font-mono uppercase text-zinc-600 tracking-wider">
                Archive
              </span>
              <span className="text-[10px] text-zinc-700 ml-auto">
                {archiveOpen ? "▾" : "▸"}
              </span>
            </button>

            {archiveOpen && (
              <div className="space-y-0.5 mt-0.5">
                {archiveLoading ? (
                  <div className="px-2.5 py-2 text-[11px] text-zinc-600">Loading...</div>
                ) : archiveItems.length === 0 ? (
                  <div className="px-2.5 py-2 text-[11px] text-zinc-600">No archived issues</div>
                ) : (
                  archiveItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-zinc-800/40 transition-colors min-w-0"
                    >
                      <Archive className="h-3 w-3 shrink-0 text-zinc-600" />
                      <span className="text-[11px] text-zinc-600 shrink-0 font-mono">
                        {item.identifier}
                      </span>
                      <span className="text-sm text-zinc-500 truncate">
                        {item.title}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/project-sidebar.tsx
git commit -m "feat(sidebar): add archived/cancelled status colors and per-project archive section"
```

---

### Task 14: Verify end-to-end

- [ ] **Step 1: Start the dev server**

Run: `cd packages/server && PROJECTS_DIR=/tmp/patchwork/projects THREADS_DIR=/tmp/patchwork/threads PORT=3002 DATABASE_URL="postgresql://patchwork:patchwork@localhost:5433/patchwork" REDIS_URL="redis://localhost:6380" bun run src/index.ts`

Check the logs for:
- "Prisma db push complete" (schema updated with `archivedAt`)
- "Full-text search indexes ready" (GIN indexes created)
- "[orchestrator] starting" (orchestrator running)
- "[archive-job]" messages if there are stale issues

- [ ] **Step 2: Start the UI**

Run: `cd packages/ui && API_SERVER_URL=http://localhost:3002 bun dev`

- [ ] **Step 3: Manual verification checklist**

1. Board loads without archived issues
2. Done/cancelled cards show "Archive" button
3. Clicking "Archive" on a done issue removes it from the board
4. `/archive` page loads with search bar
5. Searching on `/archive` page returns results
6. TopBar shows "Archive" link
7. Project sidebar shows collapsible "Archive" section

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during e2e verification"
```
