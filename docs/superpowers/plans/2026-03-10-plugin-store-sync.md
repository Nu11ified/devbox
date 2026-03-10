# Plugin Store Sync Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync Patchwork's plugin page with the official Anthropic Claude Code plugin marketplace, replacing hardcoded seed data with live marketplace data fetched periodically from GitHub.

**Architecture:** A `PluginSyncJob` background job fetches `marketplace.json` from the `anthropics/claude-plugins-official` GitHub repo every 6 hours (plus once on startup). Each plugin is upserted by slug into the existing `plugins` table with new metadata fields (homepage, verified, sourceType). The existing seed-plugins file is deleted. The UI removes install/uninstall buttons and adds a "Verified" badge for Anthropic-authored plugins.

**Tech Stack:** Express, Prisma, PostgreSQL, Next.js App Router, Tailwind CSS, lucide-react

---

## File Structure

### New Files
- `packages/server/src/plugins/sync.ts` — Plugin marketplace sync job (fetch, parse, upsert, prune)

### Modified Files
- `packages/server/prisma/schema.prisma` — Add `homepage`, `verified`, `sourceType` fields; make `instructions` nullable already done; change `builtIn` default to `false`
- `packages/server/src/index.ts` — Remove `seedPlugins` import/call, add `PluginSyncJob`
- `packages/server/src/api/plugins.ts` — Include new fields in list/detail responses, remove install/uninstall endpoints
- `packages/ui/src/lib/api.ts` — Update `PluginItem` interface with new fields, remove install/uninstall methods
- `packages/ui/src/app/plugins/page.tsx` — Remove install buttons, add verified badge, update category map

### Deleted Files
- `packages/server/src/db/seed-plugins.ts` — Replaced entirely by sync job

---

## Chunk 1: Schema + Sync Job + Server Wiring

### Task 1: Update Prisma Schema

**Files:**
- Modify: `packages/server/prisma/schema.prisma:379-400`

- [ ] **Step 1: Add new fields to Plugin model**

Open `packages/server/prisma/schema.prisma` and update the `Plugin` model (around line 379) to:

```prisma
model Plugin {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  slug         String   @unique
  name         String
  description  String
  author       String   @default("Patchwork")
  category     String   @default("general")
  icon         String?
  tags         Json     @default("[]")
  instructions String?  @db.Text
  mcpServers   Json     @default("{}") @map("mcp_servers")
  hooks        Json     @default("[]")
  tools        Json     @default("[]")
  version      String   @default("1.0.0")
  builtIn      Boolean  @default(false) @map("built_in")
  homepage     String?
  verified     Boolean  @default(false)
  sourceType   String   @default("marketplace") @map("source_type")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt    DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  installedBy InstalledPlugin[]

  @@map("plugins")
}
```

Changes from current schema:
- `builtIn` default: `true` → `false`
- New: `homepage String?`
- New: `verified Boolean @default(false)`
- New: `sourceType String @default("marketplace") @map("source_type")`

- [ ] **Step 2: Push schema and regenerate client**

Run:
```bash
cd packages/server && bunx prisma db push && bunx prisma generate
```

Expected: Schema pushed successfully, Prisma client regenerated with new fields.

- [ ] **Step 3: Commit**

```bash
git add packages/server/prisma/schema.prisma
git commit -m "feat: add homepage, verified, sourceType fields to Plugin model"
```

---

### Task 2: Create PluginSyncJob

**Files:**
- Create: `packages/server/src/plugins/sync.ts`

- [ ] **Step 1: Create the plugins directory**

```bash
mkdir -p packages/server/src/plugins
```

- [ ] **Step 2: Write the sync job**

Create `packages/server/src/plugins/sync.ts`:

```typescript
import prisma from "../db/prisma.js";

const MARKETPLACE_URL =
  "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json";
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface MarketplaceAuthor {
  name: string;
  email?: string;
}

interface MarketplacePlugin {
  name: string;
  description: string;
  category: string;
  author: MarketplaceAuthor;
  source: string | { source: string; url: string; sha?: string };
  homepage?: string;
  version?: string;
  tags?: string[];
}

interface MarketplaceJson {
  name: string;
  description: string;
  plugins: MarketplacePlugin[];
}

export class PluginSyncJob {
  private timer: ReturnType<typeof setInterval> | null = null;

  async start(): Promise<void> {
    console.log("[plugin-sync] Starting (interval: 6h)");
    // Run immediately on startup
    await this.tick();
    this.timer = setInterval(() => this.tick(), SYNC_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log("[plugin-sync] Stopped");
  }

  private async tick(): Promise<void> {
    try {
      const plugins = await this.fetchMarketplace();
      if (!plugins) return;

      const stats = await this.syncPlugins(plugins);
      console.log(
        `[plugin-sync] Done: ${stats.added} added, ${stats.updated} updated, ${stats.removed} removed`
      );
    } catch (err) {
      console.error("[plugin-sync] Sync failed:", (err as Error).message);
    }
  }

  private async fetchMarketplace(): Promise<MarketplacePlugin[] | null> {
    try {
      const res = await fetch(MARKETPLACE_URL);
      if (!res.ok) {
        console.warn(`[plugin-sync] Fetch failed: ${res.status} ${res.statusText}`);
        return null;
      }
      const data: MarketplaceJson = await res.json();
      if (!data.plugins || !Array.isArray(data.plugins)) {
        console.error("[plugin-sync] Invalid marketplace.json: missing plugins array");
        return null;
      }
      return data.plugins;
    } catch (err) {
      console.warn("[plugin-sync] Network error:", (err as Error).message);
      return null;
    }
  }

  private async syncPlugins(
    marketplacePlugins: MarketplacePlugin[]
  ): Promise<{ added: number; updated: number; removed: number }> {
    let added = 0;
    let updated = 0;

    const slugs: string[] = [];

    for (const mp of marketplacePlugins) {
      const slug = mp.name; // marketplace `name` field is the slug
      slugs.push(slug);

      // Derive display name from slug: "frontend-design" → "Frontend Design"
      const displayName = slug
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");

      const authorName =
        typeof mp.author === "object" ? mp.author.name : String(mp.author);

      // Verified = Anthropic author with local source path (official plugins)
      const sourceIsLocal =
        typeof mp.source === "string" && mp.source.startsWith("./");
      const verified = authorName === "Anthropic" && sourceIsLocal;

      const homepage =
        mp.homepage ||
        (typeof mp.source === "object" && mp.source.url
          ? mp.source.url
          : null);

      const data = {
        name: displayName,
        description: mp.description,
        author: authorName,
        category: mp.category || "general",
        icon: null as string | null,
        tags: (mp.tags ?? []) as any,
        version: mp.version || "1.0.0",
        builtIn: false,
        homepage,
        verified,
        sourceType: "marketplace",
      };

      try {
        const existing = await prisma.plugin.findUnique({ where: { slug } });
        if (existing) {
          await prisma.plugin.update({ where: { slug }, data });
          updated++;
        } else {
          await prisma.plugin.create({ data: { slug, ...data } });
          added++;
        }
      } catch (err) {
        console.error(
          `[plugin-sync] Failed to upsert plugin "${slug}":`,
          (err as Error).message
        );
      }
    }

    // Remove marketplace plugins no longer in the list
    const deleteResult = await prisma.plugin.deleteMany({
      where: {
        sourceType: "marketplace",
        slug: { notIn: slugs },
      },
    });
    const removed = deleteResult.count;

    return { added, updated, removed };
  }
}
```

Key design decisions:
- Uses `findUnique` + `update`/`create` instead of `upsert` to track added vs updated counts
- `verified` = Anthropic author + local source path (means it's in the official repo, not a community fork)
- Display name derived from slug (e.g., `frontend-design` → `Frontend Design`)
- Stale plugin removal: only deletes `sourceType: "marketplace"` plugins not in the current list (preserves any future local plugins)
- Network/parse failures are logged and skipped (no crash, retries on next interval)

- [ ] **Step 3: Verify TypeScript compiles**

Run:
```bash
cd packages/server && npx tsc --noEmit src/plugins/sync.ts
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/plugins/sync.ts
git commit -m "feat: add PluginSyncJob to fetch marketplace.json every 6h"
```

---

### Task 3: Wire Sync Job into Server + Remove Seed Plugins

**Files:**
- Modify: `packages/server/src/index.ts:27-132`
- Delete: `packages/server/src/db/seed-plugins.ts`

- [ ] **Step 1: Update index.ts imports**

In `packages/server/src/index.ts`, replace:
```typescript
import { seedPlugins } from "./db/seed-plugins.js";
```
with:
```typescript
import { PluginSyncJob } from "./plugins/sync.js";
```

- [ ] **Step 2: Replace seedPlugins call with PluginSyncJob**

In the `isMain` block (around line 91), remove:
```typescript
    await seedPlugins();
```

After the `syncJob.start()` line (around line 123), add:
```typescript
    const pluginSyncJob = new PluginSyncJob();
    await pluginSyncJob.start();
```

- [ ] **Step 3: Add cleanup to SIGTERM handler**

In the SIGTERM handler, add before `server.close()`:
```typescript
      pluginSyncJob.stop();
```

- [ ] **Step 4: Delete seed-plugins.ts**

```bash
rm packages/server/src/db/seed-plugins.ts
```

- [ ] **Step 5: Verify TypeScript compiles**

Run:
```bash
cd packages/server && npx tsc --noEmit
```

Expected: No errors (no remaining references to `seed-plugins`).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/index.ts
git rm packages/server/src/db/seed-plugins.ts
git commit -m "feat: replace seedPlugins with PluginSyncJob on startup"
```

---

### Task 4: Update Plugins API

**Files:**
- Modify: `packages/server/src/api/plugins.ts:1-134`

- [ ] **Step 1: Update the plugin list endpoint to include new fields**

In `packages/server/src/api/plugins.ts`, update the result mapping in the `GET /` handler (around line 26) to include the new fields:

```typescript
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
```

- [ ] **Step 2: Remove install/uninstall endpoints**

Delete the `POST /:id/install` and `DELETE /:id/install` route handlers (lines 87-131). These are no longer needed since plugins are delivered via the Claude Agent SDK.

Keep `GET /user/installed` for now — it's still useful for the UI to display which plugins are active.

- [ ] **Step 3: Verify TypeScript compiles**

Run:
```bash
cd packages/server && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/api/plugins.ts
git commit -m "feat: add verified/homepage/sourceType to plugin API, remove install endpoints"
```

---

## Chunk 2: UI Updates

### Task 5: Update UI Plugin Types

**Files:**
- Modify: `packages/ui/src/lib/api.ts:164-185`

- [ ] **Step 1: Add new fields to PluginItem interface**

Update the `PluginItem` interface (around line 164):

```typescript
export interface PluginItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  author: string;
  category: string;
  icon: string | null;
  tags: string[];
  version: string;
  builtIn: boolean;
  verified: boolean;
  homepage: string | null;
  sourceType: string;
  installCount: number;
  installed: boolean;
  installedAt: string | null;
}
```

- [ ] **Step 2: Remove install/uninstall API methods**

Find and remove the `installPlugin` and `uninstallPlugin` methods (around lines 598-605):

```typescript
  // DELETE these methods:
  async installPlugin(id: string): Promise<{ ok: boolean }> { ... }
  async uninstallPlugin(id: string): Promise<{ ok: boolean }> { ... }
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/lib/api.ts
git commit -m "feat: update PluginItem type with verified/homepage/sourceType"
```

---

### Task 6: Redesign Plugins Page

**Files:**
- Modify: `packages/ui/src/app/plugins/page.tsx:1-314`

- [ ] **Step 1: Update category maps**

Replace the existing `CATEGORY_LABELS` and `CATEGORY_COLORS` maps (lines 15-35) with marketplace categories:

```typescript
const CATEGORY_LABELS: Record<string, string> = {
  development: "Development",
  productivity: "Productivity",
  security: "Security",
  database: "Database",
  "language-server": "Language Server",
  integration: "Integration",
  general: "General",
};

const CATEGORY_COLORS: Record<string, string> = {
  development: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  productivity: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  security: "bg-red-500/10 text-red-400 border-red-500/20",
  database: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  "language-server": "bg-amber-500/10 text-amber-400 border-amber-500/20",
  integration: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  general: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
};
```

- [ ] **Step 2: Remove install toggle state and handler**

Remove the `toggling` state and `handleToggle` function (lines 42, 59-89):

```typescript
// DELETE:
const [toggling, setToggling] = useState<Set<string>>(new Set());

// DELETE entire handleToggle function
async function handleToggle(plugin: PluginItem) { ... }
```

Also remove the `installedCount` line:
```typescript
// DELETE:
const installedCount = plugins.filter((p) => p.installed).length;
```

- [ ] **Step 3: Update header stats**

Replace the header stats section (lines 125-133) with:

```typescript
          <div className="flex items-center gap-3 mt-3">
            <span className="text-xs font-mono text-muted-foreground/50">
              {plugins.length} plugins from Anthropic marketplace
            </span>
          </div>
```

- [ ] **Step 4: Update PluginCard to remove install buttons, add verified badge and homepage link**

Add the imports at top of file:

```typescript
import {
  Loader2,
  Search,
  Filter,
  X,
  BadgeCheck,
  ExternalLink,
} from "lucide-react";
```

(Remove `Check`, `Download` from imports since they're no longer needed.)

Replace the entire `PluginCard` component with:

```typescript
function PluginCard({ plugin }: { plugin: PluginItem }) {
  const catColor =
    CATEGORY_COLORS[plugin.category] || CATEGORY_COLORS.general;

  return (
    <div className="group relative flex flex-col rounded-xl border border-border/30 bg-card/50 hover:border-border/60 hover:bg-card/80 transition-all duration-200">
      <div className="p-4 flex-1">
        {/* Top row: icon + category badge */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <span className="text-xl leading-none">{plugin.icon || "🔧"}</span>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-medium leading-tight">
                  {plugin.name}
                </h3>
                {plugin.verified && (
                  <BadgeCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                )}
              </div>
              <span className="text-[10px] font-mono text-muted-foreground/40">
                v{plugin.version}
              </span>
            </div>
          </div>
          <span
            className={cn(
              "text-[10px] font-mono px-2 py-0.5 rounded-full border",
              catColor
            )}
          >
            {CATEGORY_LABELS[plugin.category] || plugin.category}
          </span>
        </div>

        {/* Description */}
        <p className="text-xs text-muted-foreground/60 leading-relaxed line-clamp-3 mb-3">
          {plugin.description}
        </p>

        {/* Tags */}
        <div className="flex flex-wrap gap-1">
          {(plugin.tags as string[]).slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="text-[10px] font-mono text-muted-foreground/30 bg-muted/20 px-1.5 py-0.5 rounded"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-border/20 flex items-center justify-between">
        <span className="text-[10px] font-mono text-muted-foreground/30">
          by {plugin.author}
        </span>

        {plugin.homepage && (
          <a
            href={plugin.homepage}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            Source
          </a>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Update PluginCard usage in grid**

In the grid (around line 192), simplify the PluginCard call:

```tsx
          {filtered.map((plugin) => (
            <PluginCard key={plugin.id} plugin={plugin} />
          ))}
```

- [ ] **Step 6: Verify the UI builds**

Run:
```bash
cd packages/ui && bun run build 2>&1 | head -30
```

Expected: Build succeeds or shows only unrelated warnings.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/app/plugins/page.tsx packages/ui/src/lib/api.ts
git commit -m "feat: redesign plugins page with marketplace data, verified badges"
```

---

### Task 7: Final Verification

- [ ] **Step 1: Run TypeScript check on server**

```bash
cd packages/server && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 2: Run TypeScript check on UI**

```bash
cd packages/ui && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Test sync job manually (if local server available)**

Start the server:
```bash
cd packages/server && PROJECTS_DIR=/tmp/patchwork/projects THREADS_DIR=/tmp/patchwork/threads PORT=3002 DATABASE_URL="postgresql://patchwork:patchwork@localhost:5433/patchwork" REDIS_URL="redis://localhost:6380" bun run src/index.ts
```

Expected output should include:
```
[plugin-sync] Starting (interval: 6h)
[plugin-sync] Done: ~70 added, 0 updated, 0 removed
```

- [ ] **Step 4: Verify API returns new fields**

```bash
curl -s http://localhost:3002/api/plugins | jq '.[0] | {name, verified, homepage, sourceType, category}'
```

Expected: Shows marketplace plugin with `verified`, `homepage`, `sourceType` fields.

- [ ] **Step 5: Commit any final fixes and push**

```bash
git push
```
