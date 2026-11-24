import Redis from "ioredis";
import { config } from "../config";

export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface CacheItem {
  value: string;
  expiresAt?: number;
}

// ---------------------------------------------------------------------------
// In-Memory Fallback Cache (used when Redis circuit breaker is OPEN)
// ---------------------------------------------------------------------------
const inMemoryStore = new Map<string, CacheItem>();

function inMemoryGet(key: string): string | null {
  const item = inMemoryStore.get(key);
  if (!item) return null;
  if (item.expiresAt && item.expiresAt < Date.now()) {
    inMemoryStore.delete(key);
    return null;
  }
  return item.value;
}

function inMemorySet(key: string, value: string, ttlSeconds?: number): boolean {
  const expiresAt = ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : undefined;
  inMemoryStore.set(key, { value, expiresAt });
  return true;
}

function inMemoryDel(...keys: string[]): number {
  let count = 0;
  for (const k of keys) {
    if (inMemoryStore.delete(k)) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Circuit Breaker State & Logic
// ---------------------------------------------------------------------------
const MAX_CONSECUTIVE_FAILURES = 3;
const CIRCUIT_RESET_TIMEOUT_MS = 10_000;

let circuitState: CircuitBreakerState = "CLOSED";
let consecutiveFailures = 0;
let lastFailureTime = 0;
let instance: Redis | null = null;

export function getCircuitBreakerState(): CircuitBreakerState {
  if (circuitState === "OPEN" && Date.now() - lastFailureTime > CIRCUIT_RESET_TIMEOUT_MS) {
    setCircuitState("HALF_OPEN");
  }
  return circuitState;
}

function setCircuitState(newState: CircuitBreakerState) {
  if (circuitState !== newState) {
    console.log(`[CircuitBreaker] Redis circuit transition: ${circuitState} -> ${newState}`);
    circuitState = newState;
  }
}

function recordSuccess() {
  consecutiveFailures = 0;
  if (circuitState === "HALF_OPEN") {
    setCircuitState("CLOSED");
  }
}

function recordFailure(error: unknown) {
  consecutiveFailures++;
  lastFailureTime = Date.now();
  console.warn(
    `[CircuitBreaker] Redis failure #${consecutiveFailures} (${String(error)}). Circuit state: ${circuitState}`,
  );

  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && circuitState !== "OPEN") {
    setCircuitState("OPEN");
    console.warn(
      `[CircuitBreaker] Circuit breaker OPEN after ${consecutiveFailures} consecutive Redis failures. Falling back to in-memory store.`,
    );
  }
}

/**
 * Returns the singleton Redis client with exponential backoff retry.
 */
export function getRedis(): Redis {
  if (!instance) {
    instance = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
      retryStrategy(times) {
        // Exponential backoff capped at 3000ms
        const delay = Math.min(times * 200, 3000);
        console.log(`[Redis] Reconnect attempt #${times} in ${delay}ms...`);
        return delay;
      },
    });

    instance.on("connect", () => {
      console.log("[Redis] Connected to Redis successfully");
      recordSuccess();
    });

    instance.on("error", (err) => {
      recordFailure(err);
    });
  }
  return instance;
}

/**
 * Gracefully close the Redis connection (for tests / shutdown).
 */
export async function closeRedis(): Promise<void> {
  if (instance) {
    try {
      await instance.quit();
    } catch {
      instance.disconnect();
    }
    instance = null;
  }
  inMemoryStore.clear();
}

// ---------------------------------------------------------------------------
// Typed helper functions with Circuit Breaker & In-Memory Fallback
// ---------------------------------------------------------------------------

export async function cacheSet(
  key: string,
  value: string,
  ttlSeconds?: number,
): Promise<boolean> {
  if (getCircuitBreakerState() === "OPEN") {
    return inMemorySet(key, value, ttlSeconds);
  }

  try {
    const redis = getRedis();
    if (ttlSeconds && ttlSeconds > 0) {
      const result = await redis.set(key, value, "EX", ttlSeconds);
      recordSuccess();
      return result === "OK";
    }
    const result = await redis.set(key, value);
    recordSuccess();
    return result === "OK";
  } catch (err) {
    recordFailure(err);
    return inMemorySet(key, value, ttlSeconds);
  }
}

export async function cacheGet(key: string): Promise<string | null> {
  if (getCircuitBreakerState() === "OPEN") {
    return inMemoryGet(key);
  }

  try {
    const val = await getRedis().get(key);
    recordSuccess();
    return val;
  } catch (err) {
    recordFailure(err);
    return inMemoryGet(key);
  }
}

export async function cacheDel(...keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;

  if (getCircuitBreakerState() === "OPEN") {
    return inMemoryDel(...keys);
  }

  try {
    const count = await getRedis().del(...keys);
    inMemoryDel(...keys);
    recordSuccess();
    return count;
  } catch (err) {
    recordFailure(err);
    return inMemoryDel(...keys);
  }
}

export async function acquireLock(
  key: string,
  value: string,
  ttlMs: number,
): Promise<boolean> {
  if (getCircuitBreakerState() === "OPEN") {
    const existing = inMemoryGet(key);
    if (existing !== null) return false;
    inMemorySet(key, value, Math.ceil(ttlMs / 1000));
    return true;
  }

  try {
    const result = await getRedis().set(key, value, "PX", ttlMs, "NX");
    recordSuccess();
    return result === "OK";
  } catch (err) {
    recordFailure(err);
    const existing = inMemoryGet(key);
    if (existing !== null) return false;
    inMemorySet(key, value, Math.ceil(ttlMs / 1000));
    return true;
  }
}

export async function incrBy(key: string, amount: number): Promise<number> {
  if (getCircuitBreakerState() === "OPEN") {
    const current = Number(inMemoryGet(key) || 0);
    const next = current + amount;
    inMemorySet(key, String(next));
    return next;
  }

  try {
    const result = await getRedis().incrby(key, amount);
    recordSuccess();
    return result;
  } catch (err) {
    recordFailure(err);
    const current = Number(inMemoryGet(key) || 0);
    const next = current + amount;
    inMemorySet(key, String(next));
    return next;
  }
}

export async function decrBy(key: string, amount: number): Promise<number> {
  return incrBy(key, -amount);
}

export async function getNumber(key: string): Promise<number> {
  const val = await cacheGet(key);
  return val ? Number(val) : 0;
}

export async function setExpiry(key: string, ttlSeconds: number): Promise<void> {
  if (getCircuitBreakerState() === "OPEN") {
    const existing = inMemoryGet(key);
    if (existing !== null) inMemorySet(key, existing, ttlSeconds);
    return;
  }

  try {
    await getRedis().expire(key, ttlSeconds);
    recordSuccess();
  } catch (err) {
    recordFailure(err);
    const existing = inMemoryGet(key);
    if (existing !== null) inMemorySet(key, existing, ttlSeconds);
  }
}

export async function scanKeys(pattern: string): Promise<string[]> {
  if (getCircuitBreakerState() === "OPEN") {
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    const matched: string[] = [];
    for (const k of inMemoryStore.keys()) {
      if (regex.test(k) && inMemoryGet(k) !== null) {
        matched.push(k);
      }
    }
    return matched;
  }

  try {
    const redis = getRedis();
    const keys: string[] = [];
    let cursor = "0";

    do {
      const [nextCursor, batch] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        200,
      );
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== "0");

    recordSuccess();
    return keys;
  } catch (err) {
    recordFailure(err);
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    const matched: string[] = [];
    for (const k of inMemoryStore.keys()) {
      if (regex.test(k) && inMemoryGet(k) !== null) {
        matched.push(k);
      }
    }
    return matched;
  }
}
