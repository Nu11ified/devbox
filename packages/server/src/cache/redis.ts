import { createClient, type RedisClientType } from "redis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const TTL_TIERS = {
  fast: 5 * 60,       // 5 minutes
  medium: 60 * 60,    // 1 hour
  slow: 24 * 60 * 60, // 24 hours
} as const;

export type CacheTier = keyof typeof TTL_TIERS;

let client: RedisClientType | null = null;

export async function getRedis(): Promise<RedisClientType> {
  if (!client) {
    client = createClient({ url: REDIS_URL });
    client.on("error", (err) => console.error("Redis error:", err));
    await client.connect();
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
