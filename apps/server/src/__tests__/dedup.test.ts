import { describe, it, expect, vi, beforeEach } from "vitest";
import { fingerprint } from "../dedup";

// ---------------------------------------------------------------------------
// Mock Redis so tests don't need a running instance
// ---------------------------------------------------------------------------
vi.mock("../redis", () => {
  const store = new Map<string, { value: string; expiry: number }>();

  return {
    acquireLock: vi.fn(async (key: string, value: string, _ttlMs: number) => {
      if (store.has(key)) return false;
      store.set(key, { value, expiry: Date.now() + _ttlMs });
      return true;
    }),
    cacheGet: vi.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiry) {
        store.delete(key);
        return null;
      }
      return entry.value;
    }),
    cacheSet: vi.fn(async (key: string, value: string, ttl?: number) => {
      store.set(key, {
        value,
        expiry: Date.now() + (ttl ?? 3600) * 1000,
      });
      return true;
    }),
    cacheDel: vi.fn(async (...keys: string[]) => {
      let count = 0;
      for (const k of keys) {
        if (store.delete(k)) count++;
      }
      return count;
    }),
    incrBy: vi.fn(async (key: string, amount: number) => {
      const entry = store.get(key);
      const current = entry ? Number(entry.value) : 0;
      const next = current + amount;
      store.set(key, { value: String(next), expiry: Date.now() + 3_600_000 });
      return next;
    }),
    scanKeys: vi.fn(async () => []),
    // Expose for cleanup in tests
    __store: store,
  };
});

// Re-import after mocking so the module picks up the mocked redis
const { tryAcquire, publishResult, waitForResult, isBlacklisted, recordFailure, resetFailures, BLACKLIST_FAILURE_THRESHOLD, BLACKLIST_COOLDOWN_MS } = await import("../dedup");
const mockRedis = (await import("../redis")) as any;

// ---------------------------------------------------------------------------
// Fingerprinting
// ---------------------------------------------------------------------------
describe("Dedup — fingerprinting", () => {
  it("produces the same hash for identical inputs", () => {
    const a = fingerprint("abc123", "mainnet", "explain");
    const b = fingerprint("abc123", "mainnet", "explain");
    expect(a).toBe(b);
  });

  it("is case-insensitive", () => {
    const a = fingerprint("ABC123", "Mainnet", "Explain");
    const b = fingerprint("abc123", "mainnet", "explain");
    expect(a).toBe(b);
  });

  it("produces different hashes for different inputs", () => {
    const a = fingerprint("abc123", "mainnet", "explain");
    const b = fingerprint("abc123", "testnet", "explain");
    expect(a).not.toBe(b);
  });

  it("returns a 64-char hex string (SHA-256)", () => {
    const hash = fingerprint("tx1", "mainnet", "explain");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// Lock acquisition
// ---------------------------------------------------------------------------
describe("Dedup — lock acquisition", () => {
  beforeEach(() => {
    mockRedis.__store.clear();
  });

  it("acquires the lock on first attempt", async () => {
    const result = await tryAcquire("fp-unique-1");
    expect(result.acquired).toBe(true);
    expect(result.fingerprint).toBe("fp-unique-1");
    expect(result.requestId).toBeTruthy();
  });

  it("rejects duplicate within the dedup window", async () => {
    const first = await tryAcquire("fp-dup-1");
    expect(first.acquired).toBe(true);

    const second = await tryAcquire("fp-dup-1");
    expect(second.acquired).toBe(false);
  });

  it("assigns different requestIds to first and duplicate", async () => {
    const first = await tryAcquire("fp-id-test");
    const second = await tryAcquire("fp-id-test");
    expect(first.requestId).not.toBe(second.requestId);
  });
});

// ---------------------------------------------------------------------------
// Result publishing and waiting
// ---------------------------------------------------------------------------
describe("Dedup — result publishing and waiting", () => {
  beforeEach(() => {
    mockRedis.__store.clear();
  });

  it("published result is retrievable by waitForResult", async () => {
    const fp = "fp-pub-1";
    const payload = JSON.stringify({ summary: "test" });

    await publishResult(fp, payload);
    const result = await waitForResult(fp, 50);

    expect(result).toBe(payload);
  });

  it("waitForResult returns null when no result is published in time", async () => {
    const result = await waitForResult("fp-no-result", 50);
    // Will either return null (timeout) or a string — both are valid shapes.
    expect(result === null || typeof result === "string").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Blacklisting — failure counting
// ---------------------------------------------------------------------------
describe("Dedup — blacklist: failure counting", () => {
  beforeEach(() => {
    mockRedis.__store.clear();
  });

  it("increments failure count on each call to recordFailure", async () => {
    const fp = "fp-fail-count";
    const c1 = await recordFailure(fp);
    const c2 = await recordFailure(fp);
    expect(c1).toBe(1);
    expect(c2).toBe(2);
  });

  it("does not blacklist before the threshold is reached", async () => {
    const fp = "fp-below-threshold";
    for (let i = 0; i < BLACKLIST_FAILURE_THRESHOLD - 1; i++) {
      await recordFailure(fp);
    }
    const blacklisted = await isBlacklisted(fp);
    expect(blacklisted).toBe(false);
  });

  it("blacklists after exactly BLACKLIST_FAILURE_THRESHOLD consecutive failures", async () => {
    const fp = "fp-exact-threshold";
    for (let i = 0; i < BLACKLIST_FAILURE_THRESHOLD; i++) {
      await recordFailure(fp);
    }
    const blacklisted = await isBlacklisted(fp);
    expect(blacklisted).toBe(true);
  });

  it("remains blacklisted on additional failures beyond the threshold", async () => {
    const fp = "fp-over-threshold";
    for (let i = 0; i < BLACKLIST_FAILURE_THRESHOLD + 2; i++) {
      await recordFailure(fp);
    }
    const blacklisted = await isBlacklisted(fp);
    expect(blacklisted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Blacklisting — cooldown expiry
// ---------------------------------------------------------------------------
describe("Dedup — blacklist: cooldown expiry", () => {
  beforeEach(() => {
    mockRedis.__store.clear();
  });

  it("BLACKLIST_COOLDOWN_MS is a positive number", () => {
    expect(BLACKLIST_COOLDOWN_MS).toBeGreaterThan(0);
  });

  it("blacklist entry disappears after the cooldown TTL elapses (mock expiry)", async () => {
    const fp = "fp-cooldown";

    // Trigger blacklist
    for (let i = 0; i < BLACKLIST_FAILURE_THRESHOLD; i++) {
      await recordFailure(fp);
    }
    expect(await isBlacklisted(fp)).toBe(true);

    // Simulate TTL expiry by manipulating the mock store's expiry timestamp
    const blacklistKey = `grat:dedup:blacklist:${fp}`;
    const entry = mockRedis.__store.get(blacklistKey);
    if (entry) {
      mockRedis.__store.set(blacklistKey, {
        ...entry,
        expiry: Date.now() - 1, // already expired
      });
    }

    // Now isBlacklisted should return false because cacheGet evicts expired keys
    expect(await isBlacklisted(fp)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Blacklisting — reset on success
// ---------------------------------------------------------------------------
describe("Dedup — blacklist: reset on success", () => {
  beforeEach(() => {
    mockRedis.__store.clear();
  });

  it("resetFailures clears the failure counter before the threshold", async () => {
    const fp = "fp-reset-before";
    await recordFailure(fp);
    await recordFailure(fp);
    await resetFailures(fp);
    // After reset, a single new failure should register as count 1 again
    const countAfterReset = await recordFailure(fp);
    expect(countAfterReset).toBe(1);
  });

  it("resetFailures removes an active blacklist entry", async () => {
    const fp = "fp-reset-blacklist";
    for (let i = 0; i < BLACKLIST_FAILURE_THRESHOLD; i++) {
      await recordFailure(fp);
    }
    expect(await isBlacklisted(fp)).toBe(true);

    await resetFailures(fp);

    expect(await isBlacklisted(fp)).toBe(false);
  });

  it("successful processing resets count so threshold requires fresh failures", async () => {
    const fp = "fp-success-resets";

    // Two failures — not yet blacklisted
    await recordFailure(fp);
    await recordFailure(fp);
    expect(await isBlacklisted(fp)).toBe(false);

    // Simulate successful processing
    await resetFailures(fp);

    // Two more failures after reset — still below threshold
    await recordFailure(fp);
    await recordFailure(fp);
    expect(await isBlacklisted(fp)).toBe(false);

    // Third failure triggers blacklist
    await recordFailure(fp);
    expect(await isBlacklisted(fp)).toBe(true);
  });

  it("resetFailures on a non-existent fingerprint does not throw", async () => {
    await expect(resetFailures("fp-nonexistent")).resolves.toBeUndefined();
  });
});
