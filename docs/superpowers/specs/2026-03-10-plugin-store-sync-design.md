# Plugin Store Sync Design

## Overview

Sync Patchwork's plugin page with the official Anthropic Claude Code plugin marketplace. Replace the hardcoded seed plugins with real marketplace data fetched periodically from GitHub. Metadata-only — no plugin instructions stored, since the Claude Agent SDK handles plugin functionality directly.

## Data Source

The official Anthropic plugin marketplace is a public GitHub repo:
- Repo: `anthropics/claude-plugins-official`
- Metadata file: `.claude-plugin/marketplace.json`
- Raw URL: `https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json`

The `marketplace.json` contains ~70 plugins with this structure per entry:

```json
{
  "name": "frontend-design",
  "description": "Craft production-grade frontends...",
  "category": "development",
  "author": { "name": "Anthropic", "email": "..." },
  "source": "./plugins/frontend-design",
  "homepage": "https://github.com/anthropics/claude-plugins-official",
  "version": "1.0.0",
  "tags": []
}
```

Categories in the marketplace: development, productivity, security, database, language-server, integration, and others.

Install counts are NOT in the marketplace.json — they come from the `claude.com/plugins` web page. Since scraping that page is fragile, we skip install counts for now and can add them later if an API becomes available.

## Sync Strategy

### Background Sync Job

New `PluginSyncJob` class following the existing `GitHubSyncJob` pattern:

- Runs every 6 hours on a `setInterval`
- Also runs once on server startup (after migrations)
- Fetches `marketplace.json` from GitHub raw URL
- Parses and upserts each plugin by `slug` (the `name` field)
- Removes plugins from DB that are no longer in the marketplace
- Logs sync results (added/updated/removed counts)

### Replacing Seed Plugins

- Delete `packages/server/src/db/seed-plugins.ts` entirely
- Remove `seedPlugins()` call from `packages/server/src/index.ts`
- The sync job handles all plugin data population
- First sync on startup replaces what `seedPlugins()` used to do

## Schema Changes

The existing `Plugin` model fields map well. Changes needed:

```prisma
model Plugin {
  // Existing fields kept:
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  slug        String   @unique
  name        String
  description String
  author      String   @default("Patchwork")
  category    String   @default("general")
  icon        String?
  tags        Json     @default("[]")
  version     String   @default("1.0.0")
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  // Modified fields:
  instructions String?  @db.Text  // Now nullable — metadata-only sync doesn't store instructions
  builtIn      Boolean  @default(false)  // Change default to false — all synced plugins are external

  // New fields:
  homepage     String?  // GitHub repo URL
  verified     Boolean  @default(false)  // "Anthropic Verified" badge
  sourceType   String   @default("marketplace") @map("source_type")  // "marketplace" or "local"

  // Keep existing fields (unused but harmless):
  mcpServers  Json     @default("{}")  @map("mcp_servers")
  hooks       Json     @default("[]")
  tools       Json     @default("[]")

  // Relation
  installedBy InstalledPlugin[]

  @@map("plugins")
}
```

New fields: `homepage`, `verified`, `sourceType`. Changed defaults: `builtIn` → `false`, `instructions` → nullable.

## Sync Job Implementation

New file: `packages/server/src/plugins/sync.ts`

```typescript
interface MarketplacePlugin {
  name: string;
  description: string;
  category: string;
  author: { name: string; email?: string };
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
```

Sync logic:
1. Fetch `marketplace.json` via `fetch()` from raw GitHub URL
2. Parse as `MarketplaceJson`
3. For each plugin, derive:
   - `slug` from `name` field
   - `author` from `author.name`
   - `verified` = `true` if author is "Anthropic" and source is local path (in `./plugins/`)
   - `homepage` from `homepage` field or constructed from source URL
   - `icon` = null (marketplace.json doesn't include icons)
   - `category` mapped directly
4. Upsert each plugin by `slug`
5. Delete plugins from DB where `sourceType = "marketplace"` and `slug` NOT IN the fetched list (handles removed plugins)
6. Return counts: `{ added, updated, removed }`

### Error Handling

- Network failures: log warning, skip sync, retry next interval
- Parse failures: log error with response body snippet, skip sync
- Individual plugin upsert failures: log and continue with remaining plugins

## Server Wiring

In `packages/server/src/index.ts`:
- Remove `import { seedPlugins }` and `await seedPlugins()` call
- Add `import { PluginSyncJob }` and start it after orchestrator/syncJob
- Add `pluginSyncJob.stop()` to SIGTERM handler

## API Changes

### `GET /api/plugins` — No changes needed

The existing endpoint queries the `plugins` table with install counts. It already returns the right shape. Synced data just has different content.

### Remove install/uninstall tracking (optional simplification)

Since plugins are delivered automatically via the Claude Agent SDK, the `InstalledPlugin` junction table and install/uninstall endpoints become display-only. Keep them for now — they still serve the UI's "installed" state and install count. Can simplify later.

## UI Changes

### Plugin Card Updates

In `packages/ui/src/app/plugins/page.tsx`:

1. **Remove install/uninstall buttons** — Plugins are delivered via the SDK, not user-managed
2. **Add "Verified" badge** — Show "Anthropic Verified" badge on verified plugins (green checkmark + text)
3. **Add homepage link** — Small external link icon that opens the plugin's GitHub page
4. **Update category colors** — Map new categories from marketplace (development, productivity, security, database, language-server, integration) to colors
5. **Remove install count display** — Not available from marketplace.json (can add back later)
6. **Keep search and category filter** — These work as-is with the new data

### Plugin Type Updates

In `packages/ui/src/lib/api.ts`:

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
  verified: boolean;       // NEW
  homepage: string | null;  // NEW
  sourceType: string;       // NEW
  installCount: number;
  installed: boolean;
  installedAt: string | null;
}
```

## Files to Create/Modify

### New Files
- `packages/server/src/plugins/sync.ts` — Plugin marketplace sync job

### Modified Files
- `packages/server/prisma/schema.prisma` — Add `homepage`, `verified`, `sourceType` fields; make `instructions` nullable; change `builtIn` default
- `packages/server/src/index.ts` — Remove seedPlugins, add PluginSyncJob
- `packages/server/src/api/plugins.ts` — Include new fields in query responses
- `packages/ui/src/app/plugins/page.tsx` — Remove install buttons, add verified badge, update categories
- `packages/ui/src/lib/api.ts` — Add new fields to PluginItem

### Deleted Files
- `packages/server/src/db/seed-plugins.ts` — Replaced by sync job

## Non-Goals

- No storing plugin instructions/skills/agents content — the Claude Agent SDK handles this
- No install count scraping from claude.com — fragile, can add later if API appears
- No custom/local plugin upload — only marketplace sync for now
- No plugin configuration UI — keep existing config field but don't surface it
