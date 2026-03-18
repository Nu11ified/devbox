# Tool Call Grouping & Anki Project Memory Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add client-side tool call grouping in the chat timeline, and build a project-wide Anki card system for agent long-term memory with DB storage, MCP tools, system prompt injection, and full CRUD UI.

**Architecture:** Two independent features. Feature 1 is purely client-side (grouping utility + React component). Feature 2 spans the full stack: Prisma model → REST API → MCP tools → adapter integration → Next.js UI pages. Both features can be implemented in parallel.

**Tech Stack:** Prisma (PostgreSQL), Express, Claude Agent SDK MCP tools, Next.js 16 App Router, Tailwind CSS, shadcn/ui, lucide-react

**Spec:** `docs/superpowers/specs/2026-03-18-tool-grouping-and-anki-design.md`

---

## File Structure

### Feature 1: Tool Grouping
| File | Action | Responsibility |
|------|--------|---------------|
| `packages/ui/src/components/thread/group-timeline.ts` | Create | Pure function: `groupTimelineItems()` — transforms flat timeline items into grouped items |
| `packages/ui/src/components/thread/tool-group.tsx` | Create | React component: collapsible tool group with category badges |
| `packages/ui/src/components/thread/timeline.tsx` | Modify | Add `tool_group` kind to `TimelineItem`, call grouping function, render `ToolGroup` |

### Feature 2: Anki System
| File | Action | Responsibility |
|------|--------|---------------|
| `packages/server/prisma/schema.prisma` | Modify | Add `AnkiCard` model with relations and indexes |
| `packages/server/src/api/anki.ts` | Create | REST endpoints: GET list, GET detail, POST create, PUT update, DELETE |
| `packages/server/src/index.ts` | Modify | Mount anki router |
| `packages/server/src/providers/claude-code/custom-tools.ts` | Modify | Add 5 MCP tools: `anki_list`, `anki_read`, `anki_write`, `anki_invalidate`, `anki_delete` |
| `packages/server/src/providers/claude-code/anki-staleness.ts` | Create | Staleness detection + auto-cleanup logic |
| `packages/server/src/providers/claude-code/adapter.ts` | Modify | Inject Anki TOC into system prompt, call staleness check |
| `packages/ui/src/app/projects/[projectId]/anki/page.tsx` | Create | Anki management page (card index + detail panel) |
| `packages/ui/src/components/anki/card-index.tsx` | Create | Left panel: grouped card list with search/filter |
| `packages/ui/src/components/anki/card-detail.tsx` | Create | Right panel: card content view/edit with metadata |
| `packages/ui/src/components/anki/new-card-modal.tsx` | Create | Modal for creating new cards |
| `packages/ui/src/components/project-sidebar.tsx` | Modify | Add "Anki" link below Issues section |
| `packages/ui/src/lib/api.ts` | Modify | Add Anki API client methods |

---

## Task 1: Tool Call Grouping — Utility Function

**Files:**
- Create: `packages/ui/src/components/thread/group-timeline.ts`
- Modify: `packages/ui/src/components/thread/timeline.tsx` (type only)

- [ ] **Step 1: Add `tool_group` kind to TimelineItem type**

In `packages/ui/src/components/thread/timeline.tsx`, update the `TimelineItem` interface:

```typescript
// In the kind union, add "tool_group":
kind: "user_message" | "assistant_text" | "work_item" | "approval_request" | "error" | "todo_progress" | "ask_user" | "context_compacted" | "tool_group";
// Add new optional fields for tool_group:
/** Tool group children */
groupItems?: TimelineItem[];
/** Category counts for tool group summary */
categories?: Record<string, number>;
```

- [ ] **Step 2: Write the grouping function**

Create `packages/ui/src/components/thread/group-timeline.ts`:

```typescript
import type { TimelineItem } from "./timeline";

/**
 * Groups consecutive work_item timeline entries into tool_group items.
 * Groups are bounded by:
 * - Non-work-item entries (text, approval_request, ask_user, context_compacted, todo_progress)
 * - turnId changes (groups must not span turns)
 *
 * Error items within a tool sequence stay inside the group.
 * approval_request and ask_user always break groups.
 */
export function groupTimelineItems(items: TimelineItem[]): TimelineItem[] {
  const result: TimelineItem[] = [];
  let currentGroup: TimelineItem[] = [];
  let groupTurnId: string | undefined;

  function flushGroup() {
    if (currentGroup.length === 0) return;
    const categories: Record<string, number> = {};
    for (const item of currentGroup) {
      if (item.kind === "work_item" && item.toolCategory) {
        categories[item.toolCategory] = (categories[item.toolCategory] || 0) + 1;
      }
    }
    result.push({
      id: `group-${currentGroup[0].id}`,
      kind: "tool_group",
      groupItems: currentGroup,
      categories,
      turnId: groupTurnId,
    });
    currentGroup = [];
    groupTurnId = undefined;
  }

  for (const item of items) {
    if (item.kind === "work_item") {
      // Close group if turnId changed
      if (currentGroup.length > 0 && item.turnId !== groupTurnId) {
        flushGroup();
      }
      currentGroup.push(item);
      groupTurnId = item.turnId;
    } else if (item.kind === "error" && currentGroup.length > 0) {
      // Tool-level errors (have a toolName) stay in the group as failed children.
      // Runtime errors (no toolName) break the group — they're system-level.
      if (item.toolName) {
        currentGroup.push(item);
      } else {
        flushGroup();
        result.push(item);
      }
    } else {
      // Everything else breaks the group
      flushGroup();
      result.push(item);
    }
  }
  flushGroup();

  return result;
}
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd /data/github/devbox/packages/ui && bun run build 2>&1 | head -30`
Expected: No type errors related to the new code.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/thread/group-timeline.ts packages/ui/src/components/thread/timeline.tsx
git commit -m "feat: add timeline item grouping utility for tool calls"
```

---

## Task 2: Tool Call Grouping — ToolGroup Component

**Files:**
- Create: `packages/ui/src/components/thread/tool-group.tsx`
- Modify: `packages/ui/src/components/thread/timeline.tsx` (rendering)

- [ ] **Step 1: Create the ToolGroup component**

Create `packages/ui/src/components/thread/tool-group.tsx`:

```typescript
"use client";

import { useState } from "react";
import {
  ChevronRight,
  Terminal,
  FileEdit,
  FileSearch,
  Plug,
  Wrench,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkItem } from "./work-item";
import type { TimelineItem } from "./timeline";

const categoryIcons: Record<string, typeof Terminal> = {
  command_execution: Terminal,
  file_change: FileEdit,
  file_read: FileSearch,
  mcp_tool_call: Plug,
  dynamic_tool_call: Wrench,
};

const categoryColors: Record<string, string> = {
  command_execution: "text-green-500/70",
  file_change: "text-blue-500/70",
  file_read: "text-cyan-500/70",
  mcp_tool_call: "text-purple-500/70",
  dynamic_tool_call: "text-muted-foreground/50",
};

const categoryLabels: Record<string, (n: number) => string> = {
  command_execution: (n) => `${n} command${n > 1 ? "s" : ""}`,
  file_change: (n) => `${n} file edit${n > 1 ? "s" : ""}`,
  file_read: (n) => `${n} file read${n > 1 ? "s" : ""}`,
  mcp_tool_call: (n) => `${n} tool call${n > 1 ? "s" : ""}`,
  dynamic_tool_call: (n) => `${n} action${n > 1 ? "s" : ""}`,
};

interface ToolGroupProps {
  items: TimelineItem[];
  categories: Record<string, number>;
}

export function ToolGroup({ items, categories }: ToolGroupProps) {
  const isStreaming = items.some(
    (i) => i.kind === "work_item" && !i.completed
  );
  const [expanded, setExpanded] = useState(isStreaming);

  const totalCount = Object.values(categories).reduce((a, b) => a + b, 0);

  return (
    <div className="ml-10 border rounded-lg bg-muted/5 border-border/20 overflow-hidden">
      <button
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-muted/10 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 text-muted-foreground/30 transition-transform shrink-0",
            expanded && "rotate-90"
          )}
        />

        {/* Category badges */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {Object.entries(categories).map(([cat, count]) => {
            const Icon = categoryIcons[cat] ?? Wrench;
            const color = categoryColors[cat] ?? "text-muted-foreground/50";
            const label =
              categoryLabels[cat]?.(count) ?? `${count} ${cat}`;
            return (
              <span
                key={cat}
                className="flex items-center gap-1 text-xs text-muted-foreground/60"
              >
                <Icon className={cn("h-3 w-3 shrink-0", color)} />
                <span className="font-mono">{label}</span>
              </span>
            );
          })}
        </div>

        {/* Total count + spinner */}
        <span className="text-[10px] font-mono text-muted-foreground/40 shrink-0">
          {totalCount}
        </span>
        {isStreaming && (
          <Loader2 className="h-3 w-3 text-blue-500 animate-spin shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border/10 space-y-1 py-1.5">
          {items.map((item) => {
            if (item.kind === "work_item") {
              return (
                <div key={item.id} className="px-1.5">
                  <WorkItem
                    toolName={item.toolName ?? "unknown"}
                    toolCategory={item.toolCategory ?? "dynamic_tool_call"}
                    input={item.input ?? {}}
                    output={item.output}
                    error={item.error}
                    completed={item.completed ?? true}
                    nested
                  />
                </div>
              );
            }
            if (item.kind === "error") {
              return (
                <div key={item.id} className="px-3 py-1">
                  <div className="text-[11px] text-red-400 bg-red-500/5 border border-red-500/20 rounded px-2 py-1 font-mono">
                    {item.content}
                  </div>
                </div>
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 1b: Add `nested` prop to WorkItem**

In `packages/ui/src/components/thread/work-item.tsx`, add a `nested?: boolean` prop to `WorkItemProps` and use it to conditionally remove the `ml-10` margin:

```typescript
// Update interface:
interface WorkItemProps {
  toolName: string;
  toolCategory: string;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  completed: boolean;
  nested?: boolean;  // When rendered inside a ToolGroup, omit outer margin
}

// Update root div:
<div className={cn("border rounded-lg bg-muted/5 border-border/20 overflow-hidden", !nested && "ml-10")}>
```

Update the function signature to destructure `nested`:
```typescript
export function WorkItem({ toolName, toolCategory, input, output, error, completed, nested }: WorkItemProps) {
```

- [ ] **Step 2: Integrate into Timeline component**

In `packages/ui/src/components/thread/timeline.tsx`:

1. Add imports at the top:
```typescript
import { ToolGroup } from "./tool-group";
import { groupTimelineItems } from "./group-timeline";
```

2. In the `Timeline` function, wrap items before rendering:
```typescript
// Before the return statement, add:
const groupedItems = groupTimelineItems(items);
```

3. Replace `items.map(` with `groupedItems.map(` in the JSX.

4. Add a case in the switch for `tool_group`:
```typescript
case "tool_group":
  return (
    <ToolGroup
      key={item.id}
      items={item.groupItems ?? []}
      categories={item.categories ?? {}}
    />
  );
```

- [ ] **Step 3: Verify build compiles and test visually**

Run: `cd /data/github/devbox/packages/ui && bun run build 2>&1 | head -30`
Expected: Clean build. Then verify in browser — tool calls should now be grouped between text blocks.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/thread/tool-group.tsx packages/ui/src/components/thread/timeline.tsx
git commit -m "feat: add ToolGroup component and integrate timeline grouping"
```

---

## Task 3: Anki — Prisma Schema + DB Push

**Files:**
- Modify: `packages/server/prisma/schema.prisma`

- [ ] **Step 1: Add AnkiCard model to schema**

Append to `packages/server/prisma/schema.prisma`, before the closing of the file. Also add `ankiCards AnkiCard[]` to the `Project` model's relations:

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

In the `Project` model, add the relation field:
```prisma
ankiCards  AnkiCard[]
```

- [ ] **Step 2: Generate Prisma client**

Run: `cd /data/github/devbox/packages/server && bunx prisma generate`
Expected: "Generated Prisma Client"

- [ ] **Step 3: Push schema to database**

Run: `cd /data/github/devbox/packages/server && DATABASE_URL="postgresql://patchwork:patchwork@localhost:5433/patchwork" bunx prisma db push`
Expected: "Your database is now in sync with your Prisma schema."

- [ ] **Step 4: Commit**

```bash
git add packages/server/prisma/schema.prisma
git commit -m "feat: add AnkiCard Prisma model for project-wide agent memory"
```

---

## Task 4: Anki — REST API Endpoints

**Files:**
- Create: `packages/server/src/api/anki.ts`
- Modify: `packages/server/src/index.ts`

- [ ] **Step 1: Create the anki router**

Create `packages/server/src/api/anki.ts`:

```typescript
import { Router } from "express";
import prisma from "../db/prisma.js";

// Validation constants
const MAX_GROUP_LENGTH = 50;
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENTS_LENGTH = 10_000;
const MAX_REFERENCED_FILES = 20;
const MAX_FILE_PATH_LENGTH = 500;
const GROUP_PATTERN = /^[a-z0-9-]+$/;

function validateCardInput(body: any): string | null {
  if (!body.group || typeof body.group !== "string") return "group is required";
  if (!GROUP_PATTERN.test(body.group)) return "group must be lowercase alphanumeric + hyphens";
  if (body.group.length > MAX_GROUP_LENGTH) return `group max ${MAX_GROUP_LENGTH} chars`;
  if (!body.title || typeof body.title !== "string") return "title is required";
  if (body.title.length > MAX_TITLE_LENGTH) return `title max ${MAX_TITLE_LENGTH} chars`;
  if (!body.contents || typeof body.contents !== "string") return "contents is required";
  if (body.contents.length > MAX_CONTENTS_LENGTH) return `contents max ${MAX_CONTENTS_LENGTH} chars`;
  if (body.referencedFiles) {
    if (!Array.isArray(body.referencedFiles)) return "referencedFiles must be an array";
    if (body.referencedFiles.length > MAX_REFERENCED_FILES) return `referencedFiles max ${MAX_REFERENCED_FILES} entries`;
    for (const f of body.referencedFiles) {
      if (typeof f !== "string" || f.length > MAX_FILE_PATH_LENGTH) return `each referencedFile max ${MAX_FILE_PATH_LENGTH} chars`;
    }
  }
  return null;
}

export function ankiRouter(): Router {
  const r = Router({ mergeParams: true });

  // List cards for a project
  r.get("/", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const { projectId } = req.params;

      // Verify ownership
      const project = await prisma.project.findFirst({
        where: { id: projectId, userId },
        select: { id: true },
      });
      if (!project) return res.status(404).json({ error: "Project not found" });

      const where: any = { projectId };
      if (req.query.group) where.group = req.query.group;
      if (req.query.stale === "true") where.stale = true;
      if (req.query.stale === "false") where.stale = false;

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
      const { projectId, cardId } = req.params;

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
      const { projectId } = req.params;

      // Verify ownership
      const project = await prisma.project.findFirst({
        where: { id: projectId, userId },
        select: { id: true },
      });
      if (!project) return res.status(404).json({ error: "Project not found" });

      const validationError = validateCardInput(req.body);
      if (validationError) return res.status(400).json({ error: validationError });

      const card = await prisma.ankiCard.create({
        data: {
          projectId,
          group: req.body.group.toLowerCase(),
          title: req.body.title,
          contents: req.body.contents,
          referencedFiles: req.body.referencedFiles ?? [],
        },
      });
      res.status(201).json(card);
    } catch (err: any) {
      if (err.code === "P2002") {
        return res.status(409).json({ error: "Card with this group+title already exists" });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // Update card
  r.put("/:cardId", async (req, res) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const { projectId, cardId } = req.params;

      // Verify ownership
      const existing = await prisma.ankiCard.findFirst({
        where: { id: cardId, project: { id: projectId, userId } },
      });
      if (!existing) return res.status(404).json({ error: "Card not found" });

      // Partial validation — only validate fields that are present
      const updates: any = {};
      if (req.body.group !== undefined) {
        if (!GROUP_PATTERN.test(req.body.group) || req.body.group.length > MAX_GROUP_LENGTH)
          return res.status(400).json({ error: "invalid group" });
        updates.group = req.body.group.toLowerCase();
      }
      if (req.body.title !== undefined) {
        if (req.body.title.length > MAX_TITLE_LENGTH)
          return res.status(400).json({ error: `title max ${MAX_TITLE_LENGTH} chars` });
        updates.title = req.body.title;
      }
      if (req.body.contents !== undefined) {
        if (req.body.contents.length > MAX_CONTENTS_LENGTH)
          return res.status(400).json({ error: `contents max ${MAX_CONTENTS_LENGTH} chars` });
        updates.contents = req.body.contents;
      }
      if (req.body.referencedFiles !== undefined) {
        if (!Array.isArray(req.body.referencedFiles) || req.body.referencedFiles.length > MAX_REFERENCED_FILES)
          return res.status(400).json({ error: `referencedFiles must be an array of max ${MAX_REFERENCED_FILES} entries` });
        updates.referencedFiles = req.body.referencedFiles;
      }

      // Reset staleness on content update
      if (updates.contents) {
        updates.stale = false;
        updates.staleReason = null;
        updates.lastVerifiedAt = new Date();
      }

      const card = await prisma.ankiCard.update({
        where: { id: cardId },
        data: updates,
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
      const { projectId, cardId } = req.params;

      const existing = await prisma.ankiCard.findFirst({
        where: { id: cardId, project: { id: projectId, userId } },
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
```

- [ ] **Step 2: Mount the router in index.ts**

In `packages/server/src/index.ts`, add the import and mount:

```typescript
// Import at top:
import { ankiRouter } from "./api/anki.js";

// Mount after the projects router line:
app.use("/api/projects/:projectId/anki", ankiRouter());
```

- [ ] **Step 3: Verify server compiles**

Run: `cd /data/github/devbox/packages/server && bun run build 2>&1 | head -30` (or `bunx tsc --noEmit` if no build script)
Expected: Clean build (or verify by starting the server briefly).

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/api/anki.ts packages/server/src/index.ts
git commit -m "feat: add Anki REST API endpoints for CRUD operations"
```

---

## Task 5: Anki — Staleness Detection + Auto-Cleanup

**Files:**
- Create: `packages/server/src/providers/claude-code/anki-staleness.ts`

- [ ] **Step 1: Create the staleness module**

Create `packages/server/src/providers/claude-code/anki-staleness.ts`:

```typescript
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import prisma from "../../db/prisma.js";

const STALE_CLEANUP_DAYS = 7;

/**
 * Run staleness detection and auto-cleanup for Anki cards in a project.
 * Called at the start of each agent query (before building the system prompt).
 *
 * 1. Auto-delete cards that have been stale for > 7 days
 * 2. Check if any referenced files changed since lastVerifiedAt (batched git log)
 * 3. Mark affected cards as stale
 */
export async function runAnkiStalenessCheck(
  projectId: string,
  workspacePath: string
): Promise<void> {
  try {
    // --- Phase 1: Auto-cleanup stale cards older than threshold ---
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - STALE_CLEANUP_DAYS);

    await prisma.ankiCard.deleteMany({
      where: {
        projectId,
        stale: true,
        updatedAt: { lt: cutoff },
      },
    });

    // --- Phase 2: Staleness detection via batched git log ---
    // Skip if workspace doesn't exist or isn't a git repo
    if (!existsSync(workspacePath) || !existsSync(`${workspacePath}/.git`)) {
      return;
    }

    // Find all non-stale cards with referenced files
    const cards = await prisma.ankiCard.findMany({
      where: {
        projectId,
        stale: false,
        NOT: { referencedFiles: { equals: [] } },
      },
      select: {
        id: true,
        referencedFiles: true,
        lastVerifiedAt: true,
      },
    });

    if (cards.length === 0) return;

    // Find the oldest lastVerifiedAt
    const oldest = cards.reduce(
      (min, c) => (c.lastVerifiedAt < min ? c.lastVerifiedAt : min),
      cards[0].lastVerifiedAt
    );

    // Single git log to find all files changed since oldest timestamp
    let changedFiles: Set<string>;
    try {
      const output = execFileSync(
        "git",
        ["log", `--since=${oldest.toISOString()}`, "--name-only", "--pretty=format:"],
        { cwd: workspacePath, encoding: "utf-8", timeout: 10_000 }
      );
      changedFiles = new Set(
        output
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
      );
    } catch {
      // git command failed — skip staleness check
      return;
    }

    if (changedFiles.size === 0) return;

    // Check each card's referenced files against the changed set
    for (const card of cards) {
      const staleFile = card.referencedFiles.find((f) => changedFiles.has(f));
      if (staleFile) {
        await prisma.ankiCard.update({
          where: { id: card.id },
          data: {
            stale: true,
            staleReason: `Referenced file ${staleFile} changed since last verified`,
          },
        });
      }
    }
  } catch (err: any) {
    // Non-fatal — don't block thread creation
    console.log(`[anki-staleness] Check failed: ${err.message}`);
  }
}
```

- [ ] **Step 2: Verify build**

Run: `cd /data/github/devbox/packages/server && bun run build 2>&1 | head -30` (or `bunx tsc --noEmit` if no build script)

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/providers/claude-code/anki-staleness.ts
git commit -m "feat: add Anki staleness detection and auto-cleanup"
```

---

## Task 6: Anki — MCP Tools

**Files:**
- Modify: `packages/server/src/providers/claude-code/custom-tools.ts`

- [ ] **Step 1: Add the 5 Anki MCP tools**

In `packages/server/src/providers/claude-code/custom-tools.ts`, add these tools to the array passed to `createSdkMcpServer({ tools: [...] })`, right after the existing `patchwork_update_thread_title` tool:

```typescript
// ── Anki: Project Knowledge Cards ──────────────────────────

tool({
  name: "anki_list",
  description:
    "List all Anki knowledge cards for this project. Returns a table of contents (group, title, access count, stale status). Use this to discover what project knowledge exists before reading specific cards.",
  inputSchema: {
    type: "object" as const,
    properties: {
      group: { type: "string", description: "Filter by card group (e.g. 'architecture', 'debugging')" },
      includeStale: { type: "boolean", description: "Include stale cards (default true)" },
    },
  },
  handler: async (input: { group?: string; includeStale?: boolean }) => {
    if (!ctx.projectId) return { text: "No project associated with this thread." };
    const where: any = { projectId: ctx.projectId };
    if (input.group) where.group = input.group;
    if (input.includeStale === false) where.stale = false;
    const [cards, totalCount] = await Promise.all([
      prisma.ankiCard.findMany({
        where,
        orderBy: { accessCount: "desc" },
        take: 100,
        select: {
          group: true,
          title: true,
          accessCount: true,
          lastAccessedAt: true,
          stale: true,
          staleReason: true,
        },
      }),
      prisma.ankiCard.count({ where }),
    ]);
    const result: any = { cards };
    if (totalCount > 100) {
      result.truncated = true;
      result.totalCount = totalCount;
    }
    return { text: JSON.stringify(result) };
  },
}),

tool({
  name: "anki_read",
  description:
    "Read the full contents of an Anki knowledge card. Use this when you need detailed information about a topic that exists in the project knowledge base.",
  inputSchema: {
    type: "object" as const,
    properties: {
      group: { type: "string", description: "Card group" },
      title: { type: "string", description: "Card title" },
    },
    required: ["group", "title"],
  },
  handler: async (input: { group: string; title: string }) => {
    if (!ctx.projectId) return { text: JSON.stringify({ error: "No project associated." }) };
    const card = await prisma.ankiCard.findUnique({
      where: {
        projectId_group_title: {
          projectId: ctx.projectId,
          group: input.group.toLowerCase(),
          title: input.title,
        },
      },
    });
    if (!card) return { text: JSON.stringify({ error: "Card not found" }) };
    // Atomic increment
    await prisma.ankiCard.update({
      where: { id: card.id },
      data: {
        accessCount: { increment: 1 },
        lastAccessedAt: new Date(),
      },
    });
    return {
      text: JSON.stringify({
        group: card.group,
        title: card.title,
        contents: card.contents,
        referencedFiles: card.referencedFiles,
        stale: card.stale,
        staleReason: card.staleReason,
        lastVerifiedAt: card.lastVerifiedAt,
        accessCount: card.accessCount + 1,
      }),
    };
  },
}),

tool({
  name: "anki_write",
  description:
    "Create or update an Anki knowledge card. Use this to record architecture decisions, debugging findings, guidance, or patterns you discover during your work. If a card with the same group+title exists, it will be updated.",
  inputSchema: {
    type: "object" as const,
    properties: {
      group: {
        type: "string",
        description: "Card group (lowercase, e.g. 'architecture', 'debugging', 'guidance', 'patterns')",
      },
      title: { type: "string", description: "Card title — specific and searchable" },
      contents: {
        type: "string",
        description: "Card contents in markdown. Include key details, context, and reasoning.",
      },
      referencedFiles: {
        type: "array",
        items: { type: "string" },
        description: "File paths this card describes (enables automatic staleness detection when files change)",
      },
    },
    required: ["group", "title", "contents"],
  },
  handler: async (input: {
    group: string;
    title: string;
    contents: string;
    referencedFiles?: string[];
  }) => {
    if (!ctx.projectId) return { text: JSON.stringify({ error: "No project associated." }) };
    const group = input.group.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 50);
    const title = input.title.slice(0, 200);
    const contents = input.contents.slice(0, 10_000);
    const referencedFiles = (input.referencedFiles ?? []).slice(0, 20).map((f) => f.slice(0, 500));

    // Check if card exists to determine created vs updated
    const existing = await prisma.ankiCard.findUnique({
      where: { projectId_group_title: { projectId: ctx.projectId, group, title } },
      select: { id: true },
    });

    const card = await prisma.ankiCard.upsert({
      where: {
        projectId_group_title: { projectId: ctx.projectId, group, title },
      },
      create: {
        projectId: ctx.projectId,
        group,
        title,
        contents,
        referencedFiles,
        createdByThreadId: ctx.threadId,
        updatedByThreadId: ctx.threadId,
      },
      update: {
        contents,
        referencedFiles,
        stale: false,
        staleReason: null,
        lastVerifiedAt: new Date(),
        updatedByThreadId: ctx.threadId,
      },
    });
    return {
      text: JSON.stringify({
        created: !existing,
        cardId: card.id,
      }),
    };
  },
}),

tool({
  name: "anki_invalidate",
  description:
    "Mark an Anki knowledge card as stale. Use this when you discover information in a card is wrong or outdated but you don't have a replacement yet.",
  inputSchema: {
    type: "object" as const,
    properties: {
      group: { type: "string", description: "Card group" },
      title: { type: "string", description: "Card title" },
      reason: { type: "string", description: "Why this card is stale" },
    },
    required: ["group", "title", "reason"],
  },
  handler: async (input: { group: string; title: string; reason: string }) => {
    if (!ctx.projectId) return { text: JSON.stringify({ success: false, error: "No project." }) };
    try {
      await prisma.ankiCard.update({
        where: {
          projectId_group_title: {
            projectId: ctx.projectId,
            group: input.group.toLowerCase(),
            title: input.title,
          },
        },
        data: { stale: true, staleReason: input.reason },
      });
      return { text: JSON.stringify({ success: true }) };
    } catch (err: any) {
      if (err.code === "P2025") {
        return { text: JSON.stringify({ success: false, error: "Card not found" }) };
      }
      throw err;
    }
  },
}),

tool({
  name: "anki_delete",
  description:
    "Delete an Anki knowledge card. Use this to remove cards that are no longer relevant.",
  inputSchema: {
    type: "object" as const,
    properties: {
      group: { type: "string", description: "Card group" },
      title: { type: "string", description: "Card title" },
    },
    required: ["group", "title"],
  },
  handler: async (input: { group: string; title: string }) => {
    if (!ctx.projectId) return { text: JSON.stringify({ success: false, error: "No project." }) };
    try {
      await prisma.ankiCard.delete({
        where: {
          projectId_group_title: {
            projectId: ctx.projectId,
            group: input.group.toLowerCase(),
            title: input.title,
          },
        },
      });
      return { text: JSON.stringify({ success: true }) };
    } catch (err: any) {
      if (err.code === "P2025") {
        return { text: JSON.stringify({ success: false, error: "Card not found" }) };
      }
      throw err;
    }
  },
}),
```

- [ ] **Step 2: Verify build**

Run: `cd /data/github/devbox/packages/server && bun run build 2>&1 | head -30` (or `bunx tsc --noEmit` if no build script)

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/providers/claude-code/custom-tools.ts
git commit -m "feat: add Anki MCP tools (list, read, write, invalidate, delete)"
```

---

## Task 7: Anki — System Prompt TOC Injection

**Files:**
- Modify: `packages/server/src/providers/claude-code/adapter.ts`

- [ ] **Step 1: Add TOC generation and injection**

In `packages/server/src/providers/claude-code/adapter.ts`:

1. Add import at top:
```typescript
import { runAnkiStalenessCheck } from "./anki-staleness.js";
```

2. In `runAgentQuery()`, right before the `// Build system prompt` section (around line 401), add the TOC generation. **Note:** The staleness check only runs on the first turn of a session (check `state.ankiStalenessChecked` flag) to avoid re-running on every turn. The TOC is always generated fresh since it's cheap:

```typescript
// --- Anki: staleness check + TOC generation ---
let ankiTocSection = "";
if (state.session.projectId) {
  // Run staleness check only once per session (not every turn)
  if (!state.ankiStalenessChecked) {
    await runAnkiStalenessCheck(state.session.projectId, cwd);
    state.ankiStalenessChecked = true;
  }

  const cards = await prisma.ankiCard.findMany({
    where: { projectId: state.session.projectId },
    orderBy: { accessCount: "desc" },
    take: 50,
    select: {
      group: true,
      title: true,
      accessCount: true,
      stale: true,
      staleReason: true,
    },
  });

  const totalCount = await prisma.ankiCard.count({
    where: { projectId: state.session.projectId },
  });

  if (cards.length > 0) {
    const tocRows = cards
      .map((c) => {
        const status = c.stale ? `STALE: ${c.staleReason ?? "unknown"}` : "✓";
        return `| ${c.group} | ${c.title} | ${c.accessCount} | ${status} |`;
      })
      .join("\n");

    const truncNote = totalCount > 50 ? `\n\n*Showing top 50 of ${totalCount} cards. Use \`anki_list\` to see all.*` : "";

    ankiTocSection = [
      "",
      "# Project Knowledge (Anki)",
      "",
      "You have access to a project-wide knowledge base. The current card index:",
      "",
      "| Group | Title | Reads | Status |",
      "|-------|-------|-------|--------|",
      tocRows,
      truncNote,
      "",
      "Use `anki_read` to fetch any card's full contents when relevant to your task.",
      "Use `anki_write` to record architecture decisions, debugging findings, guidance, or patterns you discover.",
      "Use `anki_invalidate` when you discover a card's information is wrong.",
      "Use `anki_delete` to remove cards that are no longer relevant.",
      "",
      "When writing cards:",
      "- Choose a descriptive group (architecture, guidance, debugging, patterns, etc.)",
      "- Title should be specific and searchable",
      "- Include file paths in referencedFiles so staleness detection works",
      "- Prefer updating an existing card over creating a near-duplicate",
      "- After completing a significant task, consider what knowledge is worth preserving for other threads",
    ].join("\n");
  }
}
```

3. Modify the system prompt building to append the Anki TOC. Update the `systemPrompt` variable construction so both branches include `ankiTocSection` in the `append`:

```typescript
const systemPrompt = isFullAccess
  ? {
      type: "preset" as const,
      preset: "claude_code" as const,
      append: [
        "# Autonomous Mode",
        // ... existing autonomous lines ...
      ].join("\n") + ankiTocSection,
    }
  : ankiTocSection
    ? {
        type: "preset" as const,
        preset: "claude_code" as const,
        append: ankiTocSection,
      }
    : { type: "preset" as const, preset: "claude_code" as const };
```

- [ ] **Step 2: Add prisma import if not already present**

Check if `prisma` is already imported in adapter.ts. If not, add:
```typescript
import prisma from "../../db/prisma.js";
```

- [ ] **Step 3: Verify build**

Run: `cd /data/github/devbox/packages/server && bun run build 2>&1 | head -30` (or `bunx tsc --noEmit` if no build script)

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/providers/claude-code/adapter.ts
git commit -m "feat: inject Anki TOC into agent system prompt with staleness check"
```

---

## Task 8: Anki — UI API Client Methods

**Files:**
- Modify: `packages/ui/src/lib/api.ts`

- [ ] **Step 1: Add Anki types and API methods**

In `packages/ui/src/lib/api.ts`, add the type definitions (near the other type definitions):

```typescript
export interface AnkiCard {
  id: string;
  projectId: string;
  group: string;
  title: string;
  contents: string;
  referencedFiles: string[];
  accessCount: number;
  lastAccessedAt: string | null;
  stale: boolean;
  staleReason: string | null;
  lastVerifiedAt: string;
  createdByThreadId: string | null;
  updatedByThreadId: string | null;
  createdAt: string;
  updatedAt: string;
}
```

Add these methods to the `PatchworkAPI` class:

```typescript
// Anki Cards
async listAnkiCards(
  projectId: string,
  filters?: { group?: string; stale?: boolean }
): Promise<AnkiCard[]> {
  const params = new URLSearchParams();
  if (filters?.group) params.set("group", filters.group);
  if (filters?.stale !== undefined) params.set("stale", String(filters.stale));
  const qs = params.toString();
  return request<AnkiCard[]>(
    `/api/projects/${projectId}/anki${qs ? `?${qs}` : ""}`
  );
}

async getAnkiCard(projectId: string, cardId: string): Promise<AnkiCard> {
  return request<AnkiCard>(`/api/projects/${projectId}/anki/${cardId}`);
}

async createAnkiCard(
  projectId: string,
  data: {
    group: string;
    title: string;
    contents: string;
    referencedFiles?: string[];
  }
): Promise<AnkiCard> {
  return request<AnkiCard>(`/api/projects/${projectId}/anki`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

async updateAnkiCard(
  projectId: string,
  cardId: string,
  data: Partial<{
    group: string;
    title: string;
    contents: string;
    referencedFiles: string[];
  }>
): Promise<AnkiCard> {
  return request<AnkiCard>(`/api/projects/${projectId}/anki/${cardId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

async deleteAnkiCard(projectId: string, cardId: string): Promise<void> {
  return request<void>(`/api/projects/${projectId}/anki/${cardId}`, {
    method: "DELETE",
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/lib/api.ts
git commit -m "feat: add Anki API client methods"
```

---

## Task 9: Anki — UI Page + Components

**Files:**
- Create: `packages/ui/src/app/projects/[projectId]/anki/page.tsx`
- Create: `packages/ui/src/components/anki/card-index.tsx`
- Create: `packages/ui/src/components/anki/card-detail.tsx`
- Create: `packages/ui/src/components/anki/new-card-modal.tsx`

- [ ] **Step 1: Create the card index component**

Create `packages/ui/src/components/anki/card-index.tsx`:

```typescript
"use client";

import { useState } from "react";
import { Search, ChevronRight, AlertTriangle, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnkiCard } from "@/lib/api";

interface CardIndexProps {
  cards: AnkiCard[];
  selectedId: string | null;
  onSelect: (card: AnkiCard) => void;
  onNewCard: () => void;
}

export function CardIndex({ cards, selectedId, onSelect, onNewCard }: CardIndexProps) {
  const [search, setSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const filtered = search
    ? cards.filter(
        (c) =>
          c.title.toLowerCase().includes(search.toLowerCase()) ||
          c.group.toLowerCase().includes(search.toLowerCase())
      )
    : cards;

  // Group cards
  const grouped = new Map<string, AnkiCard[]>();
  for (const card of filtered) {
    const list = grouped.get(card.group) ?? [];
    list.push(card);
    grouped.set(card.group, list);
  }

  function toggleGroup(group: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search + New */}
      <div className="p-3 space-y-2 border-b border-zinc-800/40">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Search cards..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-zinc-900/50 border border-zinc-800/40 rounded-lg pl-8 pr-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-700"
          />
        </div>
        <button
          onClick={onNewCard}
          className="w-full bg-zinc-800/50 hover:bg-zinc-700/50 border border-zinc-700/40 rounded-lg px-3 py-1.5 text-sm text-zinc-300 transition-colors"
        >
          + New Card
        </button>
      </div>

      {/* Card groups */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {grouped.size === 0 ? (
          <div className="px-2 py-8 text-center">
            <p className="text-sm text-zinc-500">No cards yet</p>
            <p className="text-xs text-zinc-600 mt-1">
              Cards are created by agents during their work, or you can create them manually.
            </p>
          </div>
        ) : (
          Array.from(grouped.entries()).map(([group, groupCards]) => (
            <div key={group} className="mb-1">
              <button
                onClick={() => toggleGroup(group)}
                className="flex items-center gap-1.5 w-full px-2 py-1.5 text-left hover:bg-zinc-800/30 rounded transition-colors"
              >
                <ChevronRight
                  className={cn(
                    "h-3 w-3 text-zinc-600 transition-transform",
                    !collapsedGroups.has(group) && "rotate-90"
                  )}
                />
                <span className="text-[10px] font-mono uppercase text-zinc-500 tracking-wider">
                  {group}
                </span>
                <span className="text-[10px] text-zinc-600 ml-auto">
                  {groupCards.length}
                </span>
              </button>

              {!collapsedGroups.has(group) && (
                <div className="space-y-0.5 ml-1">
                  {groupCards.map((card) => (
                    <button
                      key={card.id}
                      onClick={() => onSelect(card)}
                      className={cn(
                        "flex items-center gap-2 w-full rounded-lg px-2.5 py-1.5 text-left transition-colors min-w-0",
                        selectedId === card.id
                          ? "bg-zinc-800/60 text-zinc-100"
                          : "hover:bg-zinc-800/40 text-zinc-400"
                      )}
                    >
                      <span className="text-sm truncate flex-1">{card.title}</span>
                      <span className="flex items-center gap-1 shrink-0">
                        {card.stale && (
                          <AlertTriangle className="h-3 w-3 text-amber-500/70" />
                        )}
                        <span className="flex items-center gap-0.5 text-[10px] text-zinc-600">
                          <Eye className="h-2.5 w-2.5" />
                          {card.accessCount}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the card detail component**

Create `packages/ui/src/components/anki/card-detail.tsx`:

```typescript
"use client";

import { useState } from "react";
import { Edit3, Trash2, Save, X, FileText, AlertTriangle, Eye, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnkiCard } from "@/lib/api";

interface CardDetailProps {
  card: AnkiCard;
  onUpdate: (data: Partial<{ group: string; title: string; contents: string; referencedFiles: string[] }>) => void;
  onDelete: () => void;
}

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

export function CardDetail({ card, onUpdate, onDelete }: CardDetailProps) {
  const [editing, setEditing] = useState(false);
  const [editContents, setEditContents] = useState(card.contents);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleSave() {
    onUpdate({ contents: editContents });
    setEditing(false);
  }

  function handleCancel() {
    setEditContents(card.contents);
    setEditing(false);
  }

  function handleDelete() {
    if (confirmDelete) {
      onDelete();
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800/40 space-y-1.5">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[10px] font-mono uppercase text-zinc-500 tracking-wider">
              {card.group}
            </span>
            <h2 className="text-base font-medium text-zinc-100">{card.title}</h2>
          </div>
          <div className="flex items-center gap-1.5">
            {!editing ? (
              <button
                onClick={() => { setEditContents(card.contents); setEditing(true); }}
                className="p-1.5 rounded-md hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200 transition-colors"
                title="Edit"
              >
                <Edit3 className="h-4 w-4" />
              </button>
            ) : (
              <>
                <button
                  onClick={handleSave}
                  className="p-1.5 rounded-md hover:bg-green-500/10 text-green-500 transition-colors"
                  title="Save"
                >
                  <Save className="h-4 w-4" />
                </button>
                <button
                  onClick={handleCancel}
                  className="p-1.5 rounded-md hover:bg-zinc-800/50 text-zinc-400 transition-colors"
                  title="Cancel"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            )}
            <button
              onClick={handleDelete}
              className={cn(
                "p-1.5 rounded-md transition-colors",
                confirmDelete
                  ? "bg-red-500/20 text-red-400"
                  : "hover:bg-red-500/10 text-zinc-400 hover:text-red-400"
              )}
              title={confirmDelete ? "Click again to confirm" : "Delete"}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Stale warning */}
        {card.stale && (
          <div className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded px-2 py-1">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span>Stale: {card.staleReason}</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {editing ? (
          <textarea
            value={editContents}
            onChange={(e) => setEditContents(e.target.value)}
            className="w-full h-full min-h-[300px] bg-zinc-900/50 border border-zinc-800/40 rounded-lg p-3 text-sm text-zinc-200 font-mono focus:outline-none focus:border-zinc-700 resize-none"
          />
        ) : (
          <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed">
            {card.contents}
          </pre>
        )}
      </div>

      {/* Metadata footer */}
      <div className="px-4 py-2.5 border-t border-zinc-800/40 flex items-center gap-4 text-[10px] text-zinc-600">
        {card.referencedFiles.length > 0 && (
          <span className="flex items-center gap-1">
            <FileText className="h-3 w-3" />
            {card.referencedFiles.length} file{card.referencedFiles.length > 1 ? "s" : ""}
          </span>
        )}
        <span className="flex items-center gap-1">
          <Eye className="h-3 w-3" />
          {card.accessCount} reads
        </span>
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          verified {timeAgo(card.lastVerifiedAt)}
        </span>
        <span className="ml-auto">
          updated {timeAgo(card.updatedAt)}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create the new card modal**

Create `packages/ui/src/components/anki/new-card-modal.tsx`:

```typescript
"use client";

import { useState } from "react";
import { X } from "lucide-react";

interface NewCardModalProps {
  existingGroups: string[];
  onSave: (data: { group: string; title: string; contents: string; referencedFiles: string[] }) => void;
  onClose: () => void;
}

export function NewCardModal({ existingGroups, onSave, onClose }: NewCardModalProps) {
  const [group, setGroup] = useState(existingGroups[0] ?? "");
  const [customGroup, setCustomGroup] = useState("");
  const [title, setTitle] = useState("");
  const [contents, setContents] = useState("");
  const [filesInput, setFilesInput] = useState("");

  const effectiveGroup = group === "__custom__" ? customGroup : group;
  const isValid = effectiveGroup && /^[a-z0-9-]+$/.test(effectiveGroup) && title && contents;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    onSave({
      group: effectiveGroup,
      title,
      contents,
      referencedFiles: filesInput.split("\n").map((f) => f.trim()).filter(Boolean),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-zinc-900 border border-zinc-800/60 rounded-xl w-full max-w-lg mx-4 shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/40">
          <h3 className="text-sm font-medium text-zinc-200">New Anki Card</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-zinc-800/50 text-zinc-500">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {/* Group */}
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Group</label>
            <select
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              className="w-full bg-zinc-800/50 border border-zinc-700/40 rounded-lg px-3 py-1.5 text-sm text-zinc-200"
            >
              {existingGroups.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
              <option value="__custom__">+ New group...</option>
            </select>
            {group === "__custom__" && (
              <input
                type="text"
                placeholder="lowercase-group-name"
                value={customGroup}
                onChange={(e) => setCustomGroup(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
                className="w-full mt-1 bg-zinc-800/50 border border-zinc-700/40 rounded-lg px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600"
              />
            )}
          </div>

          {/* Title */}
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Title</label>
            <input
              type="text"
              placeholder="Card title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-zinc-800/50 border border-zinc-700/40 rounded-lg px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600"
            />
          </div>

          {/* Contents */}
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Contents</label>
            <textarea
              placeholder="Card contents (markdown)..."
              value={contents}
              onChange={(e) => setContents(e.target.value)}
              rows={8}
              className="w-full bg-zinc-800/50 border border-zinc-700/40 rounded-lg px-3 py-2 text-sm text-zinc-200 font-mono placeholder:text-zinc-600 resize-none"
            />
          </div>

          {/* Referenced Files */}
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Referenced Files (one per line, optional)</label>
            <textarea
              placeholder="src/api/routes.ts&#10;src/models/user.ts"
              value={filesInput}
              onChange={(e) => setFilesInput(e.target.value)}
              rows={3}
              className="w-full bg-zinc-800/50 border border-zinc-700/40 rounded-lg px-3 py-2 text-sm text-zinc-200 font-mono placeholder:text-zinc-600 resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isValid}
              className="px-4 py-1.5 text-sm bg-zinc-700/50 hover:bg-zinc-600/50 text-zinc-200 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Create Card
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create the Anki page**

Create `packages/ui/src/app/projects/[projectId]/anki/page.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, type AnkiCard } from "@/lib/api";
import { CardIndex } from "@/components/anki/card-index";
import { CardDetail } from "@/components/anki/card-detail";
import { NewCardModal } from "@/components/anki/new-card-modal";
import { Brain } from "lucide-react";

export default function AnkiPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [cards, setCards] = useState<AnkiCard[]>([]);
  const [selected, setSelected] = useState<AnkiCard | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadCards() {
    try {
      const data = await api.listAnkiCards(projectId);
      setCards(data);
      // Refresh selected card if it's still in the list
      if (selected) {
        const updated = data.find((c) => c.id === selected.id);
        setSelected(updated ?? null);
      }
    } catch (err) {
      console.error("Failed to load anki cards:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCards();
  }, [projectId]);

  async function handleCreate(data: {
    group: string;
    title: string;
    contents: string;
    referencedFiles: string[];
  }) {
    await api.createAnkiCard(projectId, data);
    setShowNew(false);
    await loadCards();
  }

  async function handleUpdate(
    data: Partial<{ group: string; title: string; contents: string; referencedFiles: string[] }>
  ) {
    if (!selected) return;
    await api.updateAnkiCard(projectId, selected.id, data);
    await loadCards();
  }

  async function handleDelete() {
    if (!selected) return;
    await api.deleteAnkiCard(projectId, selected.id);
    setSelected(null);
    await loadCards();
  }

  const existingGroups = [...new Set(cards.map((c) => c.group))].sort();

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-pulse text-zinc-600 text-sm">Loading cards...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex h-full">
      {/* Left: Card Index */}
      <div className="w-[280px] shrink-0 border-r border-zinc-800/40 bg-zinc-950/30">
        <CardIndex
          cards={cards}
          selectedId={selected?.id ?? null}
          onSelect={setSelected}
          onNewCard={() => setShowNew(true)}
        />
      </div>

      {/* Right: Card Detail */}
      <div className="flex-1 min-w-0">
        {selected ? (
          <CardDetail
            key={selected.id}
            card={selected}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
          />
        ) : (
          <div className="flex-1 h-full flex items-center justify-center">
            <div className="text-center space-y-3 max-w-sm">
              <div className="w-12 h-12 rounded-full bg-violet-500/10 flex items-center justify-center mx-auto">
                <Brain className="h-6 w-6 text-violet-500/60" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground/70">Project Knowledge</p>
                <p className="text-xs text-muted-foreground/50 mt-1">
                  {cards.length > 0
                    ? "Select a card to view its contents"
                    : "Agents will create knowledge cards as they work, or create them manually"}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* New Card Modal */}
      {showNew && (
        <NewCardModal
          existingGroups={existingGroups}
          onSave={handleCreate}
          onClose={() => setShowNew(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify build**

Run: `cd /data/github/devbox/packages/ui && bun run build 2>&1 | head -30`

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/app/projects/\[projectId\]/anki/page.tsx packages/ui/src/components/anki/
git commit -m "feat: add Anki management UI page with card index, detail, and creation"
```

---

## Task 10: Anki — Project Sidebar Link

**Files:**
- Modify: `packages/ui/src/components/project-sidebar.tsx`

- [ ] **Step 1: Add Anki link to the sidebar**

In `packages/ui/src/components/project-sidebar.tsx`:

1. Add `Brain` to the lucide-react import:
```typescript
import { ArrowLeft, Plus, GitBranch, CircleDot, Archive, ArchiveRestore, Users, Brain } from "lucide-react";
```

2. Add state for anki card count. In the `fetchProject` function, add an anki card fetch:
```typescript
const [ankiCount, setAnkiCount] = useState(0);
```

In the `fetchProject` function, add:
```typescript
api.listAnkiCards(projectId).then((cards) => { if (!cancelled) setAnkiCount(cards.length); }).catch(() => {});
```

3. Add the Anki section between the Issues section and the Archive section. Insert before the `{/* ── Archive Section ─── */}` comment:

```tsx
{/* ── Anki Section ──────────────────────────────── */}
<div className="px-2 py-1.5 mt-3">
  <span className="text-[10px] font-mono uppercase text-zinc-600 tracking-wider">
    Knowledge
  </span>
</div>
<Link
  href={`/projects/${projectId}/anki`}
  className={cn(
    "flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors min-w-0",
    pathname === `/projects/${projectId}/anki`
      ? "bg-zinc-800/60 text-zinc-100"
      : "hover:bg-zinc-800/40 text-zinc-400",
  )}
>
  <Brain className="h-3.5 w-3.5 text-violet-500/60 shrink-0" />
  <span className="text-sm truncate flex-1">Anki Cards</span>
  {ankiCount > 0 && (
    <span className="text-[10px] text-zinc-600 shrink-0">{ankiCount}</span>
  )}
</Link>
```

- [ ] **Step 2: Verify build and test visually**

Run: `cd /data/github/devbox/packages/ui && bun run build 2>&1 | head -30`

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/project-sidebar.tsx
git commit -m "feat: add Anki link with card count to project sidebar"
```

---

## Task 11: Integration Test — End-to-End Verification

- [ ] **Step 1: Start the dev servers**

Ensure the database is running, then start server and UI:
```bash
# Terminal 1 — Server:
cd /data/github/devbox && PROJECTS_DIR=/tmp/patchwork/projects THREADS_DIR=/tmp/patchwork/threads PORT=3002 DATABASE_URL="postgresql://patchwork:patchwork@localhost:5433/patchwork" REDIS_URL="redis://localhost:6380" bun run packages/server/src/index.ts

# Terminal 2 — UI:
cd /data/github/devbox && API_SERVER_URL=http://localhost:3002 bun --filter ui dev
```

- [ ] **Step 2: Verify tool grouping**

Open an active thread with tool calls. Verify:
- Consecutive tool calls between text blocks are grouped into collapsible drawers
- Category badges show correct counts and icons
- Expanding a group shows individual tool calls
- Streaming tools show spinner and are auto-expanded
- Groups don't span across turn boundaries

- [ ] **Step 3: Verify Anki REST API**

```bash
# List cards (empty initially)
curl -s http://localhost:3002/api/projects/<projectId>/anki | jq

# Create a card
curl -s -X POST http://localhost:3002/api/projects/<projectId>/anki \
  -H "Content-Type: application/json" \
  -d '{"group":"architecture","title":"API patterns","contents":"Routes follow RESTful conventions...","referencedFiles":["src/api/routes.ts"]}' | jq

# Read card
curl -s http://localhost:3002/api/projects/<projectId>/anki | jq

# Update card
curl -s -X PUT http://localhost:3002/api/projects/<projectId>/anki/<cardId> \
  -H "Content-Type: application/json" \
  -d '{"contents":"Updated content..."}' | jq

# Delete card
curl -s -X DELETE http://localhost:3002/api/projects/<projectId>/anki/<cardId>
```

- [ ] **Step 4: Verify Anki UI**

Navigate to `/projects/<projectId>/anki`:
- Card index shows groups and cards
- Clicking a card shows detail on the right
- "+ New Card" opens modal and creates successfully
- Edit button allows inline content editing
- Delete button requires confirmation
- Sidebar shows "Anki Cards" link with count badge

- [ ] **Step 5: Verify agent integration**

Start a new thread on a project that has Anki cards. Verify:
- The system prompt contains the Anki TOC table
- Agent can call `anki_list`, `anki_read`, `anki_write` MCP tools
- Access count increments on read
- Writing a card with the same group+title updates the existing card

- [ ] **Step 6: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: integration test fixes for tool grouping and Anki"
```
