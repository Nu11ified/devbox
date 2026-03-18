import { createClient, type RedisClientType } from "redis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const CONNECT_TIMEOUT_MS = 3000;

const TTL_TIERS = {
  fast: 5 * 60,       // 5 minutes
  medium: 60 * 60,    // 1 hour
  slow: 24 * 60 * 60, // 24 hours
} as const;

export type CacheTier = keyof typeof TTL_TIERS;

let client: RedisClientType | null = null;
let connectFailed = false;
let lastConnectAttempt = 0;
const RETRY_INTERVAL_MS = 30_000; // retry connection every 30s after failure

export async function getRedis(): Promise<RedisClientType> {
  // If a previous connect attempt failed, don't retry too frequently
  if (connectFailed) {
    if (Date.now() - lastConnectAttempt < RETRY_INTERVAL_MS) {
      throw new Error("Redis connection previously failed, waiting before retry");
    }
    // Reset for retry
    connectFailed = false;
    client = null;
  }

  if (!client) {
    lastConnectAttempt = Date.now();
    client = createClient({ url: REDIS_URL });
    client.on("error", (err) => {
      // Only log once per failure cycle to avoid flooding
      if (!connectFailed) {
        console.error("Redis error:", err.message);
      }
    });

    // Race connection against a timeout so we don't hang forever
    try {
      await Promise.race([
        client.connect(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Redis connect timeout")), CONNECT_TIMEOUT_MS)
        ),
      ]);
    } catch (err) {
      connectFailed = true;
      // Destroy the client so the next attempt creates a fresh one
      try { await client.disconnect(); } catch {}
      client = null;
      throw err;
    }
  }
  return client;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const redis = await getRedis();
    const data = await redis.get(key);
    if (!data) return null;
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

export async function cacheSet<T>(key: string, value: T, tier: CacheTier): Promise<void> {
  try {
    const redis = await getRedis();
    await redis.set(key, JSON.stringify(value), { EX: TTL_TIERS[tier] });
  } catch {
    // Cache write failures are non-critical
  }
}

export async function cacheInvalidate(pattern: string): Promise<void> {
  try {
    const redis = await getRedis();
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(keys);
    }
  } catch {
    // Cache invalidation failures are non-critical
  }
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
