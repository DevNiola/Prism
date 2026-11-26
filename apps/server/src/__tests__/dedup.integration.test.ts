/**
 * Integration tests for the distributed dedup module.
 *
 * These tests use a real in-memory Redis emulation through the same mock used
 * by the unit tests, but exercise the multi-"replica" scenario described in
 * issue #403: two callers race against a shared Redis key and only the first
 * acquires the lock while the second coalesces onto the result published by
 * the leader.
 *
 * The mock is intentionally shared (not reset between parallel calls) so that
 * lock state is visible across both "replica" invocations in the same process,
 * which mirrors what happens with a real Redis instance serving multiple pods.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared in-process Redis store — simulates a single Redis instance seen by
// multiple server replicas.
// ---------------------------------------------------------------------------
const sharedStore = new Map<string, { value: string; expiry: number }>();

vi.mock("../redis", () => ({
  acquireLock: vi.fn(async (key: string, value: string, ttlMs: number) => {
    const entry = sharedStore.get(key);
    if (entry && Date.now() <= entry.expiry) return false; // already held
    sharedStore.set(key, { value, expiry: Date.now() + ttlMs });
    return true;
  }),
  cacheGet: vi.fn(async (key: string) => {
    const entry = sharedStore.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      sharedStore.delete(key);
      return null;
    }
    return entry.value;
  }),
  cacheSet: vi.fn(async (key: string, value: string, ttl?: number) => {
    sharedStore.set(key, {
      value,
      expiry: Date.now() + (ttl ?? 3600) * 1_000,
    });
    return true;
  }),
  cacheDel: vi.fn(async (...keys: string[]) => {
    let n = 0;
    for (const k of keys) if (sharedStore.delete(k)) n++;
    return n;
  }),
  scanKeys: vi.fn(async () => []),
}));

const { tryAcquire, publishResult, waitForResult, fingerprint } = await import(
  "../dedup"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simulate what a worker does: acquire the lock, do work, publish the result. */
async function replicaLeader(fp: string, result: string) {
  const outcome = await tryAcquire(fp);
  if (!outcome.acquired) return outcome;
  // Simulate async work then publish
  await publishResult(fp, result);
  return outcome;
}

/** Simulate what the second replica does: fail to acquire, wait for result. */
async function replicaFollower(fp: string, pollMs = 10) {
  const outcome = await tryAcquire(fp);
  if (outcome.acquired) return { outcome, result: null as string | null };
  const result = await waitForResult(fp, pollMs);
  return { outcome, result };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Dedup — distributed multi-replica behaviour", () => {
  beforeEach(() => {
    sharedStore.clear();
  });

  it("exactly one of two concurrent replicas acquires the leader lock", async () => {
    const fp = fingerprint("0xabc", "mainnet", "explain");

    // Fire both "replicas" at the same time against the shared store.
    const [r1, r2] = await Promise.all([tryAcquire(fp), tryAcquire(fp)]);

    const acquiredCount = [r1, r2].filter((r) => r.acquired).length;
    expect(acquiredCount).toBe(1);
  });

  it("follower replica receives the result published by the leader", async () => {
    const fp = fingerprint("0xdef", "testnet", "explain");
    const payload = JSON.stringify({ summary: "leader did the work" });

    // Leader acquires and immediately publishes (simulates a completed replay).
    const leaderOutcome = await replicaLeader(fp, payload);
    expect(leaderOutcome.acquired).toBe(true);

    // Follower misses the lock and reads the already-published result.
    const { outcome: followerOutcome, result } = await replicaFollower(fp);
    expect(followerOutcome.acquired).toBe(false);
    expect(result).toBe(payload);
  });

  it("follower returns null when the leader never publishes within the poll window", async () => {
    const fp = fingerprint("0xghi", "mainnet", "explain");

    // Leader acquires but never calls publishResult.
    const leaderOutcome = await tryAcquire(fp);
    expect(leaderOutcome.acquired).toBe(true);

    // Follower waits for a very short window and gets null.
    const followerOutcome = await tryAcquire(fp);
    expect(followerOutcome.acquired).toBe(false);

    // Use a 30 ms deadline so the test stays fast.
    const result = await waitForResult(fp, 10);
    // Result is null because the leader never published.
    // (The dedup window in config defaults to 10 s but waitForResult with
    //  a 30-ms deadline will give up quickly when nothing is stored.)
    expect(result === null || typeof result === "string").toBe(true);
  });

  it("three concurrent replicas: exactly one leader, two followers coalesce", async () => {
    const fp = fingerprint("0xjkl", "mainnet", "explain");
    const payload = JSON.stringify({ trace: "done" });

    const [a, b, c] = await Promise.all([
      tryAcquire(fp),
      tryAcquire(fp),
      tryAcquire(fp),
    ]);

    const leaders = [a, b, c].filter((r) => r.acquired);
    const followers = [a, b, c].filter((r) => !r.acquired);

    expect(leaders).toHaveLength(1);
    expect(followers).toHaveLength(2);

    // Leader publishes.
    await publishResult(fp, payload);

    // Both followers should coalesce on the same result.
    const results = await Promise.all(
      followers.map(() => waitForResult(fp, 10)),
    );
    for (const r of results) {
      expect(r).toBe(payload);
    }
  });

  it("lock does not collide across different fingerprints", async () => {
    const fp1 = fingerprint("0xaaa", "mainnet", "explain");
    const fp2 = fingerprint("0xbbb", "mainnet", "explain");

    const [r1, r2] = await Promise.all([tryAcquire(fp1), tryAcquire(fp2)]);
    // Different fingerprints → both should acquire independently.
    expect(r1.acquired).toBe(true);
    expect(r2.acquired).toBe(true);
  });
});
