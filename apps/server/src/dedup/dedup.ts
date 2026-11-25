/**
 * Distributed request deduplication backed by Redis.
 *
 * ## Cross-replica behaviour (issue #403)
 *
 * With multiple server replicas each replica calls `tryAcquire` on the same
 * Redis key (via SET NX PX).  Redis guarantees that at most one replica wins
 * the atomic SET NX — that replica is the leader and must do the work then
 * call `publishResult`.  Every other replica sees `acquired: false` and must
 * call `waitForResult` to coalesce on the leader's response.  Because both
 * the dedup lock key and the result key live in Redis, the behaviour is
 * identical regardless of which physical pod handles each request.
 *
 * Key layout
 *   grat:dedup:<fingerprint>   – lock key (TTL = dedupWindowMs)
 *   grat:result:<fingerprint>  – result key (TTL = dedupWindowMs + 2 s)
 */
import { createHash, randomUUID } from "node:crypto";
import { acquireLock, cacheGet, cacheSet } from "../redis";
import { config } from "../config";

// ---------------------------------------------------------------------------
// Key prefix constants
// ---------------------------------------------------------------------------
const DEDUP_PREFIX = "grat:dedup:";
const RESULT_PREFIX = "grat:result:";

// ---------------------------------------------------------------------------
// Request fingerprinting
// ---------------------------------------------------------------------------

/**
 * Produces a deterministic SHA-256 fingerprint from the canonical fields of a
 * request.  Two requests with the same txHash + network + requestType will
 * always hash to the same value — this is the dedup key.
 */
export function fingerprint(
  txHash: string,
  network: string,
  requestType: string,
): string {
  const canonical = `${txHash.toLowerCase()}:${network.toLowerCase()}:${requestType.toLowerCase()}`;
  return createHash("sha256").update(canonical).digest("hex");
}

// ---------------------------------------------------------------------------
// Dedup lifecycle
// ---------------------------------------------------------------------------

export interface DedupAcquireResult {
  /** Whether this caller "won" the lock and should do the work. */
  acquired: boolean;

  /** The fingerprint (dedup key). */
  fingerprint: string;

  /** Unique ID for this request attempt. */
  requestId: string;
}

/**
 * Attempt to acquire the dedup lock for a given request fingerprint.
 *
 * - If acquired → this caller is responsible for doing the work and then
 *   calling `publishResult()`.
 * - If NOT acquired → a duplicate is already in-flight. Call `waitForResult()`
 *   to coalesce on the original request's response.
 */
export async function tryAcquire(fp: string): Promise<DedupAcquireResult> {
  const requestId = randomUUID();
  const dedupKey = `${DEDUP_PREFIX}${fp}`;
  const windowMs = config.cache.dedupWindowMs;

  const acquired = await acquireLock(dedupKey, requestId, windowMs);

  return { acquired, fingerprint: fp, requestId };
}

/**
 * Publish the result of a completed (or failed) request so any coalesced
 * waiters can pick it up.  The result is stored for the duration of the
 * dedup window so that late arrivals still find it.
 */
export async function publishResult(fp: string, result: string): Promise<void> {
  const resultKey = `${RESULT_PREFIX}${fp}`;
  const ttlSeconds = Math.ceil(config.cache.dedupWindowMs / 1000) + 2; // small padding
  await cacheSet(resultKey, result, ttlSeconds);
}

/**
 * Wait for the original request to finish and return its result.
 *
 * Polls the result key at short intervals until it appears or the
 * dedup window expires.  Returns `null` if the window closes without
 * a result (caller should retry or fail).
 */
export async function waitForResult(
  fp: string,
  pollIntervalMs = 250,
): Promise<string | null> {
  const resultKey = `${RESULT_PREFIX}${fp}`;
  const deadline = Date.now() + config.cache.dedupWindowMs + 2_000; // extra buffer

  while (Date.now() < deadline) {
    const value = await cacheGet(resultKey);
    if (value !== null) return value;
    await sleep(pollIntervalMs);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
