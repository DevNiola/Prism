import { randomUUID } from "node:crypto";
import type { CacheEntryType } from "../ai/types";
import { cacheSet, cacheGet, cacheDel, scanKeys, acquireLock } from "../redis";
import { PROMPT_VERSION_HASH } from "../ai/prompts";
import { config } from "../config";

// ---------------------------------------------------------------------------
// Key schema: grat:cache:{type}:{promptVersion}:{fingerprint}
// ---------------------------------------------------------------------------

function cacheKey(type: CacheEntryType, fingerprint: string): string {
  return `grat:cache:${type}:${PROMPT_VERSION_HASH}:${fingerprint}`;
}

/**
 * Derive a partial key pattern that matches all prompt-versions for a given
 * type + fingerprint.  Used for version-independent invalidation.
 */
function allVersionsPattern(type: CacheEntryType, fingerprint: string): string {
  return `grat:cache:${type}:*:${fingerprint}`;
}

// ---------------------------------------------------------------------------
// TTL resolution
// ---------------------------------------------------------------------------
function ttlFor(type: CacheEntryType): number {
  switch (type) {
    case "decode":
    case "explain":
      return config.cache.decodeTtl;
    case "profile":
      return config.cache.profileTtl;
    default:
      return config.cache.decodeTtl;
  }
}

// ---------------------------------------------------------------------------
// Stats tracking
// ---------------------------------------------------------------------------
export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  invalidations: number;
  stampedesAvoided: number;
}

let stats: CacheStats = {
  hits: 0,
  misses: 0,
  sets: 0,
  invalidations: 0,
  stampedesAvoided: 0,
};

export function getCacheStats(): CacheStats {
  return { ...stats };
}

export function getHitMissRatio(): { ratio: number; hits: number; misses: number } {
  const total = stats.hits + stats.misses;
  const ratio = total === 0 ? 0 : Number((stats.hits / total).toFixed(4));
  return { ratio, hits: stats.hits, misses: stats.misses };
}

function logCacheRatio() {
  const { ratio, hits, misses } = getHitMissRatio();
  import("../logger").then(({ logger }) => {
    logger.debug("Cache hit/miss stats", { ratio, hits, misses });
  }).catch(() => {});
}

export function resetCacheStats(): void {
  stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    invalidations: 0,
    stampedesAvoided: 0,
  };
}

// ---------------------------------------------------------------------------
// In-process single-flight map (stampede protection within one replica)
// ---------------------------------------------------------------------------
const inflight = new Map<string, Promise<string | null>>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Store a value in the cache with the appropriate TTL and prompt-version tag.
 */
export async function setCache(
  type: CacheEntryType,
  fingerprint: string,
  value: string,
): Promise<void> {
  const key = cacheKey(type, fingerprint);
  await cacheSet(key, value, ttlFor(type));
  stats.sets++;
}

/**
 * Retrieve a cached value. Returns `null` on miss (including version mismatch).
 *
 * Uses an in-process single-flight map so that concurrent calls for the same
 * key coalesce onto a single Redis fetch rather than all issuing independently.
 */
export async function getCache(
  type: CacheEntryType,
  fingerprint: string,
): Promise<string | null> {
  const key = cacheKey(type, fingerprint);

  // Coalesce onto an in-flight request for the same key (stampede protection)
  const existing = inflight.get(key);
  if (existing) {
    stats.stampedesAvoided = (stats.stampedesAvoided ?? 0) + 1;
    return existing;
  }

  const promise = cacheGet(key)
    .then((result) => {
      if (result !== null) {
        stats.hits++;
      } else {
        stats.misses++;
      }
      logCacheRatio();
      return result;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

/**
 * Manually invalidate an entry directly by exact cache key.
 */
export async function invalidateByKey(key: string): Promise<boolean> {
  const count = await cacheDel(key);
  if (count > 0) {
    stats.invalidations += count;
    return true;
  }
  return false;
}

/**
 * Manually invalidate an entry by type and fingerprint.
 */
export async function invalidateKey(
  type: CacheEntryType,
  fingerprint: string,
): Promise<boolean> {
  const key = cacheKey(type, fingerprint);
  return invalidateByKey(key);
}

/**
 * Invalidate all cached entries for a specific transaction hash.
 *
 * Because we fingerprint on `txHash + network + requestType`, we need to scan
 * for keys matching the txHash across all types. This is intentionally broad.
 */
export async function invalidateByTxHash(txHash: string): Promise<number> {
  const pattern = `grat:cache:*:*:*${txHash.toLowerCase()}*`;
  const keys = await scanKeys(pattern);
  if (keys.length === 0) return 0;
  const count = await cacheDel(...keys);
  stats.invalidations += count;
  return count;
}

/**
 * Invalidate a specific cache entry across all prompt versions.
 */
export async function invalidateEntry(
  type: CacheEntryType,
  fingerprint: string,
): Promise<number> {
  const pattern = allVersionsPattern(type, fingerprint);
  const keys = await scanKeys(pattern);
  if (keys.length === 0) return 0;
  const count = await cacheDel(...keys);
  stats.invalidations += count;
  return count;
}

/**
 * Clear all cached entries of a given type.
 */
export async function clearByType(type: CacheEntryType): Promise<number> {
  const pattern = `grat:cache:${type}:*`;
  const keys = await scanKeys(pattern);
  if (keys.length === 0) return 0;
  const count = await cacheDel(...keys);
  stats.invalidations += count;
  return count;
}

/**
 * Clear the entire AI cache.
 */
export async function clearAll(): Promise<number> {
  const pattern = "grat:cache:*";
  const keys = await scanKeys(pattern);
  if (keys.length === 0) return 0;
  const count = await cacheDel(...keys);
  stats.invalidations += count;
  return count;
}

/**
 * Cross-replica single-flight: acquire a Redis lock before computing an expensive
 * value. If the lock is already held (another replica is computing), poll for the
 * cache result until it appears or the timeout expires.
 *
 * @param type - cache entry type
 * @param fingerprint - cache fingerprint
 * @param compute - async function that produces the value to cache
 * @param lockTtlMs - how long to hold the lock (default 10s)
 * @param pollIntervalMs - how often to re-check the cache while locked out (default 200ms)
 * @param pollTimeoutMs - max time to wait for another replica's result (default 8s)
 */
export async function getOrFetchWithLock(
  type: CacheEntryType,
  fingerprint: string,
  compute: () => Promise<string>,
  lockTtlMs = 10_000,
  pollIntervalMs = 200,
  pollTimeoutMs = 8_000,
): Promise<string> {
  // 1. Fast path: cache hit
  const cached = await getCache(type, fingerprint);
  if (cached !== null) return cached;

  // 2. Try to acquire the distributed lock
  const lockKey = `grat:lock:${type}:${fingerprint}`;
  const lockValue = randomUUID();
  const acquired = await acquireLock(lockKey, lockValue, lockTtlMs);

  if (!acquired) {
    // Another replica holds the lock — poll until the cache is populated
    const deadline = Date.now() + pollTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      const result = await cacheGet(cacheKey(type, fingerprint));
      if (result !== null) {
        stats.hits++;
        stats.stampedesAvoided = (stats.stampedesAvoided ?? 0) + 1;
        return result;
      }
    }
    // Timeout — fall through and compute anyway (defensive)
  }

  try {
    // 3. We hold the lock (or timed out waiting) — compute the value
    const value = await compute();
    await setCache(type, fingerprint, value);
    return value;
  } finally {
    // 4. Release lock by deleting it (best-effort)
    try {
      await cacheDel(lockKey);
    } catch {}
  }
}
