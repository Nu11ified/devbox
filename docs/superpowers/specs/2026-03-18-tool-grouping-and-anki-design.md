# Tool Call Grouping & Anki Project Memory

**Date:** 2026-03-18
**Status:** Draft
**Scope:** Two features — client-side tool call grouping in chat UI, and project-wide Anki card system for agent long-term memory

---

## Problem Statement

### Tool Call Grouping
The chat timeline renders every tool call as an individual collapsible row. When the agent performs many operations (reading files, running commands, searching), the timeline becomes a wall of individual items that's hard to scan. Users want to see the assistant's reasoning (text) punctuated by collapsible summaries of what it did, not every individual operation.

### Anki Project Memory
Threads are ephemeral — when a thread's context window fills, information is lost to compaction. When a new thread starts on the same project, it has zero knowledge of what previous threads discovered (architecture patterns, debugging findings, operational guidance). This leads to repeated work, re-discovery of the same patterns, and context bloat from re-reading the same files.

---

## Feature 1: Tool Call Grouping (Client-Side)

### Approach
Purely client-side. No server or event stream changes. The timeline builder post-processes the flat item list into grouped items.

### Grouping Algorithm

1. Walk timeline items in order
2. When a `work_item` is encountered, start accumulating into a group
3. Keep accumulating `work_item`s until one of these closes the group:
   - A non-work-item is hit (text, ask_user, approval_request, context_compacted, todo_progress)
   - The `turnId` changes (groups must not span turns)
4. `error` items within a tool sequence stay inside the group (rendered as failed children), but `runtime.error` items break the group
5. Each group becomes a `tool_group` timeline item containing the child items
6. Within the group, sub-group by `toolCategory` for display
7. `approval_request` items break the group — they render at top level since user interaction is required

### Edge Cases
- A single tool call still gets wrapped in a group (consistent rendering)
- While a turn is streaming and tools are still running, the group stays "open" (shows spinner, auto-expanded)
- `approval_request` and `ask_user` items always render at top level, breaking any active group

### New Timeline Item Kind

```typescript
interface ToolGroupItem extends BaseTimelineItem {
  kind: "tool_group";
  items: WorkItemTimelineItem[];
  categories: Record<string, number>; // category → count (Record, not Map, for serialization safety)
  turnId: string;
}
```

Note: `streaming` is derived from `items.some(i => !i.completed)` rather than stored — avoids needing to track global turn state in the grouping function.

### New Component: `ToolGroup`

- **Collapsed** (default): Single row with category summary badges — e.g., `Read 5 files · Ran 3 commands · 1 search`. Total count, chevron to expand.
- **Expanded**: Child `WorkItem`s grouped by category with category headers.
- **Streaming**: Auto-expanded, spinner on header, count updates live.
- **Color coding**: Reuse existing category colors (green for bash, blue for file edits, cyan for reads, purple for MCP, gray for dynamic).

### File Changes

| File | Change |
|------|--------|
| `packages/ui/src/components/thread/group-timeline.ts` | **New** — `groupTimelineItems()` utility function |
| `packages/ui/src/components/thread/tool-group.tsx` | **New** — `ToolGroup` component |
| `packages/ui/src/components/thread/timeline.tsx` | Call `groupTimelineItems()` before rendering, handle `tool_group` kind |
| `packages/ui/src/app/projects/[projectId]/threads/[id]/page.tsx` | Add `tool_group` to `TimelineItem` union type |

---

## Feature 2: Anki — Project-Wide Agent Memory

### Data Model

New Prisma model:

```prisma
model AnkiCard {
  id                String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  projectId         String    @map("project_id") @db.Uuid
  project           Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  group             String    @db.VarChar(50)
  title             String    @db.VarChar(200)
  contents          String
  referencedFiles   String[]  @map("referenced_files")
  accessCount       Int       @default(0) @map("access_count")
  lastAccessedAt    DateTime? @map("last_accessed_at") @db.Timestamptz
  stale             Boolean   @default(false)
  staleReason       String?   @map("stale_reason")
  lastVerifiedAt    DateTime  @default(now()) @map("last_verified_at") @db.Timestamptz
  createdByThreadId String?   @map("created_by_thread_id") @db.Uuid
  updatedByThreadId String?   @map("updated_by_thread_id") @db.Uuid
  createdAt         DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt         DateTime  @updatedAt @map("updated_at") @db.Timestamptz

  @@unique([projectId, group, title])
  @@index([projectId])
  @@index([projectId, stale])
  @@map("anki_card")
}
```

Key constraints:
- `@@unique([projectId, group, title])` — upsert semantics. Writing to the same group+title overwrites.
- `@db.Uuid` on all ID fields — matches existing schema pattern (`dbgenerated("gen_random_uuid()")`).
- `@@index([projectId])` and `@@index([projectId, stale])` — primary query paths for TOC and staleness checks.
- `@db.VarChar(50)` on group, `@db.VarChar(200)` on title — prevents unbounded agent-written values.
- `referencedFiles` — file paths for staleness detection. Max 20 entries (enforced in MCP tool + API validation).
- `contents` — max 10,000 characters (enforced in MCP tool + API validation, not at DB level).
- `accessCount` — incremented atomically on every `anki_read` via Prisma `{ increment: 1 }` to avoid race conditions.
- `lastAccessedAt` — tracks when a card was last read (distinct from `updatedAt` which tracks writes). Useful for "not accessed in N days" cleanup queries.
- `createdByThreadId` / `updatedByThreadId` — traceability.
- `onDelete: Cascade` — cards are deleted when their parent project is deleted.

### Staleness Detection

Runs at **thread start** (during session initialization). Uses a batched approach to avoid per-card git invocations:

1. Find the oldest `lastVerifiedAt` across all non-stale cards with `referencedFiles` for the project
2. Run a single `git log --since=<oldest> --name-only --pretty=format:""` in the project workspace to get all files changed since that timestamp
3. Collect the changed file set
4. For each non-stale card, check if any of its `referencedFiles` appear in the changed file set
5. If matched → set `stale = true`, `staleReason = "referenced file <path> changed since last verified"`

This is O(1) git invocations regardless of card count, plus O(cards × referencedFiles) set lookups in memory.

**Fallback**: If the workspace is not a git repository or doesn't exist, skip staleness detection entirely. Cards remain in their current state until next check.

### Auto-Cleanup

During the same thread-start check:
1. Query cards where `stale = true` AND `updatedAt` older than **7 days**
2. Hard delete them
3. Lifecycle: **active → stale → auto-deleted** (if not re-verified within 7 days)

High-access stale cards get re-verified quickly because agents pull them often. Low-access stale cards decay naturally.

### MCP Tools

Exposed via the existing Patchwork MCP server (`custom-tools.ts`):

#### `anki_list` — Table of Contents
```
Input:  { group?: string, includeStale?: boolean (default true) }
Output: [{ group, title, accessCount, lastAccessedAt, stale, staleReason }]
```
Sorted by accessCount descending. No card contents — just the index. Capped at **100 cards** in the response; if more exist, includes a `truncated: true` flag and `totalCount` so the agent knows there are more.

#### `anki_read` — Fetch Card Contents
```
Input:  { group: string, title: string }
Output: { group, title, contents, referencedFiles, stale, staleReason, lastVerifiedAt, accessCount }
Error:  { error: "Card not found" } if no matching card exists
```
Side effect: atomically increments `accessCount` via Prisma `{ increment: 1 }` and updates `lastAccessedAt`.

#### `anki_write` — Create or Update Card
```
Input:  { group: string, title: string, contents: string, referencedFiles?: string[] }
Output: { created: boolean, cardId: string }
```
Upserts by (projectId, group, title). Resets `stale` to false, `lastVerifiedAt` to now. On update, `accessCount` is preserved (not reset).

#### `anki_invalidate` — Mark Card Stale
```
Input:  { group: string, title: string, reason: string }
Output: { success: boolean }
Error:  { success: false, error: "Card not found" } if no matching card exists
```

#### `anki_delete` — Remove Card
```
Input:  { group: string, title: string }
Output: { success: boolean }
Error:  { success: false, error: "Card not found" } if no matching card exists
```
Hard delete from DB.

### Input Validation

Applied in both MCP tool handlers and REST API endpoints:
- `group`: required, max 50 characters, lowercase alphanumeric + hyphens (normalized to lowercase on write)
- `title`: required, max 200 characters
- `contents`: required, max 10,000 characters
- `referencedFiles`: optional, max 20 entries, each max 500 characters

### Authorization

- **REST API endpoints**: Use the existing auth/tenant middleware. Queries join through `Project.userId` to enforce ownership.
- **MCP tool handlers**: The agent session is already scoped to a project+user. The MCP context carries `projectId` which was validated at session creation. No additional auth check needed in the tool handler since the session can only exist for an authorized user — but the `projectId` from context must always be used (never accept projectId as tool input).

### System Prompt Integration

Appended to system prompt for **all threads** (manual and autonomous):

```
# Project Knowledge (Anki)

You have access to a project-wide knowledge base. The current card index:

| Group | Title | Reads | Status |
|-------|-------|-------|--------|
| architecture | API route patterns | 12 | ✓ |
| architecture | Prisma conventions | 8 | STALE: schema.prisma changed |
| ... | ... | ... | ... |

Use `anki_read` to fetch any card's full contents when relevant to your task.
Use `anki_write` to record architecture decisions, debugging findings, guidance, or patterns you discover.
Use `anki_invalidate` when you discover a card's information is wrong.
Use `anki_delete` to remove cards that are no longer relevant.

When writing cards:
- Choose a descriptive group (architecture, guidance, debugging, patterns, etc.)
- Title should be specific and searchable
- Include file paths in referencedFiles so staleness detection works
- Prefer updating an existing card over creating a near-duplicate
- After completing a significant task, consider what knowledge is worth preserving for other threads
```

### Token Cost
- ~30 cards: 50-80 tokens for the TOC. Negligible.
- ~100 cards: under 300 tokens. Still minimal.
- Card contents loaded on-demand via `anki_read` — only what's needed enters context.
- **TOC cap**: The system prompt injects at most 50 cards (top by accessCount). If more exist, a note says "and N more — use `anki_list` to see all." This bounds worst-case token cost to ~200 tokens regardless of total card count.

### In-Thread Caching
The LLM's context window IS the cache. Once `anki_read` is called, the content persists in context. If compaction summarizes it away, the agent can re-read (access count increments again, reflecting actual usage).

### API Endpoints (UI CRUD)

```
GET    /api/projects/:projectId/anki           → list all cards
GET    /api/projects/:projectId/anki/:cardId   → get card detail
POST   /api/projects/:projectId/anki           → create card
PUT    /api/projects/:projectId/anki/:cardId   → update card
DELETE /api/projects/:projectId/anki/:cardId   → delete card
```

New router: `packages/server/src/api/anki.ts`. Same auth/tenant middleware as existing routes. The list endpoint supports `?group=<name>` and `?stale=true|false` query parameters for filtering.

### UI: Anki Management Panel

**Route:** `/projects/[projectId]/anki`

**Layout:**
- **Left — Card Index**: Grouped by card group (collapsible sections). Each row: title, access count badge, stale indicator. Sorted by access count within group. Search/filter bar. "+ New Card" button.
- **Right — Card Detail**: Full markdown-rendered contents. Edit button for inline editing. Referenced files as clickable chips. Metadata footer (created/updated by thread, last verified, access count). Delete button with confirmation.

**New Card Modal:**
- Group (dropdown of existing + freeform input)
- Title
- Contents (markdown textarea)
- Referenced files (multi-input)

**Project Sidebar:** "Anki" link below Issues with badge showing total card count.

### File Changes

| File | Change |
|------|--------|
| `packages/server/prisma/schema.prisma` | Add `AnkiCard` model, relation to `Project` |
| `packages/server/src/api/anki.ts` | **New** — REST endpoints for CRUD |
| `packages/server/src/index.ts` | Mount anki router |
| `packages/server/src/providers/claude-code/custom-tools.ts` | Add `anki_list`, `anki_read`, `anki_write`, `anki_invalidate`, `anki_delete` tools |
| `packages/server/src/providers/claude-code/adapter.ts` | Inject Anki TOC into system prompt, run staleness check + auto-cleanup at query start (before building system prompt) |
| `packages/ui/src/app/projects/[projectId]/anki/page.tsx` | **New** — Anki management page |
| `packages/ui/src/components/anki/card-index.tsx` | **New** — Card index panel |
| `packages/ui/src/components/anki/card-detail.tsx` | **New** — Card detail/edit panel |
| `packages/ui/src/components/anki/new-card-modal.tsx` | **New** — Create card modal |
| `packages/ui/src/components/project-sidebar.tsx` | Add Anki link with card count badge |
| `packages/ui/src/lib/api.ts` | Add Anki API client methods |

---

## Testing Strategy

### Tool Grouping
- Unit test `groupTimelineItems()` with various sequences (text-only, tools-only, mixed, approval interruptions, streaming states)
- Visual verification in browser

### Anki
- API endpoint tests (CRUD operations, upsert behavior, access count increment)
- Staleness detection test (mock file changes, verify stale flag)
- Auto-cleanup test (stale cards older than 7 days get deleted)
- MCP tool integration test (tools return expected shapes)
- System prompt injection test (TOC renders correctly)

---

## Out of Scope
- Full-text search across card contents (can add later)
- Card versioning/history (git handles this if needed)
- Cross-project card sharing
- AI-powered card suggestions ("you should write a card about X")
- Card templates or required fields per group
