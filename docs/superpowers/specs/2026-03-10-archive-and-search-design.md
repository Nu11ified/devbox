# Archive & Search Design

## Overview

Three integrated features: auto-archiving completed issues off the board, browsable archive views with full-text search, and agent context injection that searches past thread transcripts before starting autonomous work.

## Data Model

### Issue Status Lifecycle

```
open → queued → in_progress → review → done → archived
                                        cancelled → archived
```

New `archived` status added to the existing lifecycle. Both `done` and `cancelled` issues archive. Add `"archived"` to the `IssueStatus` union type in `packages/shared/src/types.ts`.

### Schema Changes

```prisma
model Issue {
  // ... existing fields ...
  archivedAt DateTime? @map("archived_at") @db.Timestamptz
}
```

Single new nullable field. Status value `"archived"` handled by the existing `status` string column.

Update `updateIssue` in `queries.ts` to include `archivedAt` in its `fieldMap` so it can be set and cleared.

### Full-Text Search Indexes

Use `COALESCE` to handle nullable columns safely:

```sql
CREATE INDEX idx_thread_turns_search ON thread_turns
  USING GIN (to_tsvector('english', COALESCE(content, '')));

CREATE INDEX idx_issues_title_search ON issues
  USING GIN (to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(body, '')));
```

All search queries must use the same `COALESCE` wrapping to match the index and avoid NULL errors.

## Auto-Archive

### Behavior

- Issues with `status = 'done'` or `status = 'cancelled'` auto-archive after 24 hours (based on `updatedAt`)
- Server-side job runs every 30 minutes
- Sets `status = 'archived'`, `archivedAt = now()`
- Board explicitly excludes archived issues (see Board Changes)

### Implementation

New function in `packages/server/src/orchestrator/archive-job.ts`:

```typescript
export async function archiveStaleIssues(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
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
```

Started alongside the existing GitHub sync job in `packages/server/src/index.ts` on a 30-minute interval.

### Manual Archive

"Archive" button on board cards for `done` and `cancelled` issues. Calls `PUT /api/issues/:id` with `{ status: "archived" }`.

### Un-Archiving

When an issue is moved out of `archived` status (e.g., re-opened), `archivedAt` must be set to `null`. The `updateIssue` function handles this: when `status` changes away from `"archived"`, set `archivedAt: null` automatically.

## Board Changes

- Add "Archive" button on done/cancelled issue cards (alongside existing "Done" and cancel buttons)
- No new columns — archived issues are simply filtered out
- **Critical**: `findAllIssues` must exclude archived by default. Add `status: { notIn: ["archived"] }` to the default query when no status filter is provided. The board calls `api.listIssues()` with no status filter, so this default exclusion is required.
- The existing board column definition stays as-is (Open, Queued, In Progress, Review, Done)

## Archive Views

### Global Archive Page

New route: `/archive`

- Added to TopBar navigation alongside Board, Plugins, Settings
- Full-text search bar across issue titles, bodies, and thread turn content
- Filters: project dropdown, date range
- Results show: identifier, title, status badge (done/cancelled), project name, age, PR link
- Each result links to the thread view (`/projects/{projectId}/threads/{threadId}`)
- Paginated (20 per page)

### Per-Project Archive Tab

In the project sidebar (`packages/ui/src/components/project-sidebar.tsx`):

- New "Archive" section below the existing threads list
- Fetches data via `GET /api/archive?projectId={id}` (the same archive search endpoint, scoped to project)
- Compact list format (identifier + title + age)
- Expandable/collapsible section, collapsed by default

### Search API

New endpoint: `GET /api/archive`

Query params:
- `q` — full-text search query (optional, returns all archived if empty)
- `projectId` — scope to project (optional)
- `page` / `limit` — pagination (default 20)

Implementation uses `DISTINCT ON` and `COALESCE` to handle NULLs and dedup:

```typescript
// Search across issues and thread content
const results = await prisma.$queryRaw`
  SELECT DISTINCT ON (i.id) i.*,
    COALESCE(
      ts_headline('english', COALESCE(t.content, ''),
        plainto_tsquery('english', ${query}),
        'MaxWords=30, MinWords=15'),
      ''
    ) as snippet
  FROM issues i
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
```

When `q` is empty, returns all archived issues ordered by `archivedAt DESC` without the full-text filter (simple Prisma query, no raw SQL needed).

## Agent Context Injection

### When

Before the dispatcher sends the autonomous prompt in `packages/server/src/orchestrator/dispatcher.ts`, inside the `dispatchIssue` function (which is already async). The context search happens at the call site, not inside the synchronous `buildAutonomousPrompt` helper.

### How

1. Extract search terms from the issue title and body (strip common words, keep file paths, component names, error patterns)
2. Query archived thread turns using full-text search
3. Take top 3 matching thread snippets (highest `ts_rank`)
4. Cap total context at ~2000 tokens (~8000 chars)
5. Append to the prompt string as a `## Relevant Past Work` section

### Implementation

New function in `packages/server/src/orchestrator/context-search.ts`:

```typescript
export async function findRelevantContext(
  issueTitle: string,
  issueBody: string,
  projectId?: string
): Promise<string | null> {
  const searchTerms = extractSearchTerms(issueTitle + " " + issueBody);
  if (!searchTerms) return null;

  const results = await prisma.$queryRaw`
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
  for (const r of results) {
    context += `### ${r.identifier}: ${r.issue_title}\n${r.snippet}\n\n`;
  }

  // Cap at ~8000 chars (~2000 tokens)
  return context.length > 8000 ? context.slice(0, 8000) + "\n..." : context;
}
```

### Prompt Integration

In `dispatchIssue()` (async), after building the prompt and before sending the turn:

```typescript
let prompt = buildAutonomousPrompt(issue);
const pastContext = await findRelevantContext(issue.title, issue.body, issue.projectId);
if (pastContext) {
  prompt += "\n\n" + pastContext;
}
```

The agent uses this context only if relevant — it's informational, not directive.

## Files to Create/Modify

### New Files
- `packages/server/src/orchestrator/archive-job.ts` — auto-archive cron job
- `packages/server/src/orchestrator/context-search.ts` — full-text search for agent context
- `packages/server/src/api/archive.ts` — archive search API endpoint
- `packages/ui/src/app/archive/page.tsx` — global archive page

### Modified Files
- `packages/server/prisma/schema.prisma` — add `archivedAt` field
- `packages/server/src/index.ts` — start archive job, run GIN index creation SQL on startup
- `packages/server/src/orchestrator/dispatcher.ts` — inject context into prompt (in `dispatchIssue`, not `buildAutonomousPrompt`)
- `packages/server/src/db/queries.ts` — add `archivedAt` to `updateIssue` fieldMap, exclude archived from `findAllIssues` by default
- `packages/ui/src/app/board/page.tsx` — add Archive button on done/cancelled cards
- `packages/ui/src/components/top-bar.tsx` — add Archive nav link
- `packages/ui/src/components/project-sidebar.tsx` — add per-project archive section, add archived color to `issueStatusColor`
- `packages/ui/src/lib/api.ts` — add archive API methods
- `packages/shared/src/types.ts` — add `"archived"` to `IssueStatus` union type

## Non-Goals

- No embedding/vector search — full-text search with PostgreSQL GIN indexes is sufficient
- No real-time search-as-you-type — standard form submission search
- No archive for threads without issues — only issue-linked threads are archived
- No automatic un-archiving — once archived, stays archived unless manually re-opened
