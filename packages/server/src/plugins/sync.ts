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
        console.warn(
          `[plugin-sync] Fetch failed: ${res.status} ${res.statusText}`
        );
        return null;
      }
      const data: MarketplaceJson = await res.json();
      if (!data.plugins || !Array.isArray(data.plugins)) {
        console.error(
          "[plugin-sync] Invalid marketplace.json: missing plugins array"
        );
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
      const slug = mp.name;
      slugs.push(slug);

      // Derive display name: "frontend-design" → "Frontend Design"
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

    return { added, updated, removed: deleteResult.count };
  }
}
