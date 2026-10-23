import type { CacheEntryType } from "../ai/types";
import { cacheSet, cacheGet, cacheDel, scanKeys } from "../redis";
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
}

let stats: CacheStats = {
  hits: 0,
  misses: 0,
  sets: 0,
  invalidations: 0,
};

export function getCacheStats(): CacheStats {
  return { ...stats };
}

export function resetCacheStats(): void {
  stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    invalidations: 0,
  };
}

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
 */
export async function getCache(
  type: CacheEntryType,
  fingerprint: string,
): Promise<string | null> {
  const key = cacheKey(type, fingerprint);
  const result = await cacheGet(key);
  if (result !== null) {
    stats.hits++;
  } else {
    stats.misses++;
  }
  return result;
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
