import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------
const store = new Map<string, { value: string; expiry: number }>();

vi.mock("../redis", () => ({
  cacheSet: vi.fn(async (key: string, value: string, ttl?: number) => {
    store.set(key, {
      value,
      expiry: Date.now() + (ttl ?? 3600) * 1000,
    });
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
  cacheDel: vi.fn(async (...keys: string[]) => {
    let count = 0;
    for (const k of keys) {
      if (store.delete(k)) count++;
    }
    return count;
  }),
  scanKeys: vi.fn(async (pattern: string) => {
    const regex = new RegExp(
      "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
    );
    return Array.from(store.keys()).filter((k) => regex.test(k));
  }),
}));

// Mock config
vi.mock("../config", () => ({
  config: {
    cache: {
      decodeTtl: 86400,
      profileTtl: 3600,
    },
  },
}));

// Mock prompt version hash to a stable value
vi.mock("../ai/prompts", () => ({
  PROMPT_VERSION_HASH: "test12345678",
}));

const {
  setCache,
  getCache,
  invalidateKey,
  invalidateByKey,
  invalidateByTxHash,
  invalidateEntry,
  clearByType,
  clearAll,
  getCacheStats,
  resetCacheStats,
} = await import("../cache");

describe("Cache — basic operations", () => {
  beforeEach(() => {
    store.clear();
  });

  it("setCache + getCache round-trip", async () => {
    await setCache("explain", "fp-1", '{"summary":"hello"}');
    const result = await getCache("explain", "fp-1");
    expect(result).toBe('{"summary":"hello"}');
  });

  it("getCache returns null on miss", async () => {
    const result = await getCache("explain", "nonexistent");
    expect(result).toBeNull();
  });

  it("different types do not collide", async () => {
    await setCache("explain", "fp-1", '"explain-data"');
    await setCache("profile", "fp-1", '"profile-data"');

    expect(await getCache("explain", "fp-1")).toBe('"explain-data"');
    expect(await getCache("profile", "fp-1")).toBe('"profile-data"');
  });
});

describe("Cache — invalidation", () => {
  beforeEach(() => {
    store.clear();
  });

  it("invalidateEntry removes a specific entry across prompt versions", async () => {
    // Simulate entries from different prompt versions
    store.set("grat:cache:explain:v1hash:fp-a", {
      value: "old",
      expiry: Date.now() + 100_000,
    });
    store.set("grat:cache:explain:v2hash:fp-a", {
      value: "new",
      expiry: Date.now() + 100_000,
    });

    const removed = await invalidateEntry("explain", "fp-a");
    expect(removed).toBe(2);
    expect(store.size).toBe(0);
  });

  it("invalidateByTxHash removes entries containing the tx hash", async () => {
    const txHash = "abc123def";
    store.set(`grat:cache:explain:test12345678:${txHash}`, {
      value: "data",
      expiry: Date.now() + 100_000,
    });
    store.set(`grat:cache:profile:test12345678:other-fp`, {
      value: "keep",
      expiry: Date.now() + 100_000,
    });

    const removed = await invalidateByTxHash(txHash);
    expect(removed).toBe(1);
    expect(store.size).toBe(1);
  });

  it("clearByType removes all entries of a given type", async () => {
    store.set("grat:cache:explain:h:fp-1", {
      value: "a",
      expiry: Date.now() + 100_000,
    });
    store.set("grat:cache:explain:h:fp-2", {
      value: "b",
      expiry: Date.now() + 100_000,
    });
    store.set("grat:cache:profile:h:fp-3", {
      value: "c",
      expiry: Date.now() + 100_000,
    });

    const removed = await clearByType("explain");
    expect(removed).toBe(2);
    expect(store.size).toBe(1);
  });

  it("clearAll removes everything", async () => {
    store.set("grat:cache:explain:h:fp-1", {
      value: "a",
      expiry: Date.now() + 100_000,
    });
    store.set("grat:cache:profile:h:fp-2", {
      value: "b",
      expiry: Date.now() + 100_000,
    });

    const removed = await clearAll();
    expect(removed).toBe(2);
    expect(store.size).toBe(0);
  });
});

describe("Cache — version-based invalidation", () => {
  beforeEach(() => {
    store.clear();
  });

  it("cache miss on prompt version mismatch (different version tag in key)", async () => {
    // Write with current mock prompt version "test12345678"
    await setCache("explain", "fp-version-test", '"current"');

    // The key includes "test12345678", so getCache with the same mock will hit.
    expect(await getCache("explain", "fp-version-test")).toBe('"current"');

    // If the prompt version changed, the key would differ and this would be a miss.
    // We verify by directly checking the key contains the version hash.
    const keys = Array.from(store.keys());
    expect(keys[0]).toContain("test12345678");
  });
});

describe("Cache — TTL expiry", () => {
  beforeEach(() => {
    store.clear();
    resetCacheStats();
  });

  it("entries expire after TTL and return null on get", async () => {
    const key = "grat:cache:explain:test12345678:fp-ttl";
    // Store an entry that expired in the past
    store.set(key, {
      value: "expired-data",
      expiry: Date.now() - 1000,
    });

    const result = await getCache("explain", "fp-ttl");
    expect(result).toBeNull();
    // Cache entry should be deleted upon detecting expiration
    expect(store.has(key)).toBe(false);
  });

  it("entries before TTL expiry return the valid cached value", async () => {
    const key = "grat:cache:explain:test12345678:fp-valid";
    store.set(key, {
      value: "valid-data",
      expiry: Date.now() + 50_000,
    });

    const result = await getCache("explain", "fp-valid");
    expect(result).toBe("valid-data");
  });
});

describe("Cache — manual invalidation by key", () => {
  beforeEach(() => {
    store.clear();
    resetCacheStats();
  });

  it("manual invalidation by exact key deletes the entry", async () => {
    await setCache("decode", "fp-manual-1", '"decoded-data"');
    const key = "grat:cache:decode:test12345678:fp-manual-1";
    expect(store.has(key)).toBe(true);

    const deleted = await invalidateByKey(key);
    expect(deleted).toBe(true);
    expect(store.has(key)).toBe(false);

    const miss = await getCache("decode", "fp-manual-1");
    expect(miss).toBeNull();
  });

  it("manual invalidation by type and fingerprint deletes the entry", async () => {
    await setCache("profile", "fp-manual-2", '"profile-data"');
    expect(await getCache("profile", "fp-manual-2")).toBe('"profile-data"');

    const deleted = await invalidateKey("profile", "fp-manual-2");
    expect(deleted).toBe(true);
    expect(await getCache("profile", "fp-manual-2")).toBeNull();
  });

  it("invalidation returns false for non-existent key", async () => {
    const deleted = await invalidateByKey("nonexistent-key");
    expect(deleted).toBe(false);
  });
});

describe("Cache — hit and miss tracking", () => {
  beforeEach(() => {
    store.clear();
    resetCacheStats();
  });

  it("tracks hits, misses, sets, and invalidations accurately", async () => {
    const stats0 = getCacheStats();
    expect(stats0).toEqual({ hits: 0, misses: 0, sets: 0, invalidations: 0 });

    // 1 miss
    await getCache("explain", "fp-stat-1");
    expect(getCacheStats().misses).toBe(1);
    expect(getCacheStats().hits).toBe(0);

    // 1 set
    await setCache("explain", "fp-stat-1", '"val1"');
    expect(getCacheStats().sets).toBe(1);

    // 1 hit
    await getCache("explain", "fp-stat-1");
    expect(getCacheStats().hits).toBe(1);

    // 1 manual invalidation
    await invalidateKey("explain", "fp-stat-1");
    expect(getCacheStats().invalidations).toBe(1);

    // After invalidation, get is another miss
    await getCache("explain", "fp-stat-1");
    expect(getCacheStats().misses).toBe(2);
  });
});

describe("Cache — concurrent access", () => {
  beforeEach(() => {
    store.clear();
    resetCacheStats();
  });

  it("handles concurrent sets and gets consistently without data corruption", async () => {
    const tasks = Array.from({ length: 25 }, (_, i) => async () => {
      const fp = `concurrent-fp-${i}`;
      const payload = JSON.stringify({ index: i, timestamp: Date.now() });

      await setCache("decode", fp, payload);
      const readBack = await getCache("decode", fp);
      expect(readBack).toBe(payload);
    });

    await Promise.all(tasks.map((t) => t()));

    const stats = getCacheStats();
    expect(stats.sets).toBe(25);
    expect(stats.hits).toBe(25);
    expect(stats.misses).toBe(0);
    expect(store.size).toBe(25);
  });
});
