import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------
const counters = new Map<string, number>();
const expiries = new Map<string, number>();

vi.mock("../redis", () => ({
  incrBy: vi.fn(async (key: string, amount: number) => {
    const current = counters.get(key) ?? 0;
    const next = current + amount;
    counters.set(key, next);
    return next;
  }),
  decrBy: vi.fn(async (key: string, amount: number) => {
    const current = counters.get(key) ?? 0;
    const next = current - amount;
    counters.set(key, next);
    return next;
  }),
  getNumber: vi.fn(async (key: string) => {
    return counters.get(key) ?? 0;
  }),
  setExpiry: vi.fn(async (key: string, ttl: number) => {
    expiries.set(key, ttl);
  }),
}));

// Mock config with well-known limits so thresholds are easy to reason about
vi.mock("../config", () => ({
  config: {
    budget: {
      hourlyTokenLimit: 1000,
      dailyTokenLimit: 5000,
      maxConcurrentRequests: 2,
    },
  },
}));

const {
  assertBudgetAvailable,
  getBudgetStatus,
  recordUsage,
  acquireConcurrency,
  releaseConcurrency,
} = await import("../budget");

const { BudgetExceededError, ConcurrencyLimitError } =
  await import("../budget/errors");

// ---------------------------------------------------------------------------
// Status checks
// ---------------------------------------------------------------------------
describe("Budget — status checks", () => {
  beforeEach(() => {
    counters.clear();
    expiries.clear();
  });

  it("returns allowed=true when under all limits", async () => {
    const status = await getBudgetStatus();
    expect(status.allowed).toBe(true);
    expect(status.hourly_remaining).toBe(1000);
    expect(status.daily_remaining).toBe(5000);
    expect(status.concurrent_active).toBe(0);
  });

  it("returns allowed=false when hourly limit is exceeded", async () => {
    counters.set("grat:budget:hourly", 1001);
    const status = await getBudgetStatus();
    expect(status.allowed).toBe(false);
    expect(status.hourly_remaining).toBe(0);
  });

  it("returns allowed=false when daily limit is exceeded", async () => {
    counters.set("grat:budget:daily", 5001);
    const status = await getBudgetStatus();
    expect(status.allowed).toBe(false);
    expect(status.daily_remaining).toBe(0);
  });

  it("returns allowed=false when concurrency limit is met", async () => {
    counters.set("grat:budget:concurrent", 2);
    const status = await getBudgetStatus();
    expect(status.allowed).toBe(false);
  });

  it("includes valid ISO reset timestamps", async () => {
    const status = await getBudgetStatus();
    expect(() => new Date(status.hourly_reset_at)).not.toThrow();
    expect(() => new Date(status.daily_reset_at)).not.toThrow();
    expect(new Date(status.hourly_reset_at).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });
});

// ---------------------------------------------------------------------------
// Threshold detection at 50 %, 80 %, 100 %
// ---------------------------------------------------------------------------
describe("Budget — threshold detection", () => {
  beforeEach(() => {
    counters.clear();
    expiries.clear();
  });

  it("50% hourly usage — still allowed", async () => {
    counters.set("grat:budget:hourly", 500); // 50% of 1000
    const status = await getBudgetStatus();
    expect(status.allowed).toBe(true);
    expect(status.hourly_remaining).toBe(500);
  });

  it("80% hourly usage — still allowed", async () => {
    counters.set("grat:budget:hourly", 800); // 80% of 1000
    const status = await getBudgetStatus();
    expect(status.allowed).toBe(true);
    expect(status.hourly_remaining).toBe(200);
  });

  it("100% hourly usage — blocked", async () => {
    counters.set("grat:budget:hourly", 1000); // 100% of 1000
    const status = await getBudgetStatus();
    // hourly_remaining is 0, so allowed must be false
    expect(status.allowed).toBe(false);
    expect(status.hourly_remaining).toBe(0);
  });

  it("50% daily usage — still allowed", async () => {
    counters.set("grat:budget:daily", 2500); // 50% of 5000
    const status = await getBudgetStatus();
    expect(status.allowed).toBe(true);
    expect(status.daily_remaining).toBe(2500);
  });

  it("80% daily usage — still allowed", async () => {
    counters.set("grat:budget:daily", 4000); // 80% of 5000
    const status = await getBudgetStatus();
    expect(status.allowed).toBe(true);
    expect(status.daily_remaining).toBe(1000);
  });

  it("100% daily usage — blocked", async () => {
    counters.set("grat:budget:daily", 5000); // 100% of 5000
    const status = await getBudgetStatus();
    expect(status.allowed).toBe(false);
    expect(status.daily_remaining).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Alert emission — assertBudgetAvailable throws on threshold cross
// ---------------------------------------------------------------------------
describe("Budget — alert emission on threshold cross", () => {
  beforeEach(() => {
    counters.clear();
    expiries.clear();
  });

  it("does not throw when under limits", async () => {
    await expect(assertBudgetAvailable()).resolves.toBeUndefined();
  });

  it("throws BudgetExceededError when hourly limit is exceeded", async () => {
    counters.set("grat:budget:hourly", 1500);
    await expect(assertBudgetAvailable()).rejects.toThrow(BudgetExceededError);
  });

  it("throws BudgetExceededError when daily limit is exceeded", async () => {
    counters.set("grat:budget:daily", 6000);
    await expect(assertBudgetAvailable()).rejects.toThrow(BudgetExceededError);
  });

  it("BudgetExceededError carries remaining counts", async () => {
    counters.set("grat:budget:hourly", 1500);
    try {
      await assertBudgetAvailable();
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      const budgetErr = err as InstanceType<typeof BudgetExceededError>;
      expect(budgetErr.hourlyRemaining).toBe(0);
      expect(budgetErr.resetAt).toBeInstanceOf(Date);
    }
  });

  it("throws ConcurrencyLimitError when at max concurrency", async () => {
    counters.set("grat:budget:concurrent", 2);
    await expect(assertBudgetAvailable()).rejects.toThrow(
      ConcurrencyLimitError,
    );
  });

  it("ConcurrencyLimitError carries active and limit counts", async () => {
    counters.set("grat:budget:concurrent", 2);
    try {
      await assertBudgetAvailable();
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConcurrencyLimitError);
      const concErr = err as InstanceType<typeof ConcurrencyLimitError>;
      expect(concErr.currentActive).toBe(2);
      expect(concErr.limit).toBe(2);
    }
  });
});

// ---------------------------------------------------------------------------
// Recording usage
// ---------------------------------------------------------------------------
describe("Budget — recording usage", () => {
  beforeEach(() => {
    counters.clear();
    expiries.clear();
  });

  it("increments hourly and daily counters", async () => {
    await recordUsage(150);
    expect(counters.get("grat:budget:hourly")).toBe(150);
    expect(counters.get("grat:budget:daily")).toBe(150);
  });

  it("accumulates across multiple calls", async () => {
    await recordUsage(100);
    await recordUsage(200);
    expect(counters.get("grat:budget:hourly")).toBe(300);
    expect(counters.get("grat:budget:daily")).toBe(300);
  });

  it("sets expiry on first write", async () => {
    await recordUsage(50);
    expect(expiries.has("grat:budget:hourly")).toBe(true);
    expect(expiries.has("grat:budget:daily")).toBe(true);
  });

  it("does not overwrite expiry on subsequent writes", async () => {
    await recordUsage(50);
    const firstHourlyTtl = expiries.get("grat:budget:hourly");
    const firstDailyTtl = expiries.get("grat:budget:daily");

    await recordUsage(50);
    expect(expiries.get("grat:budget:hourly")).toBe(firstHourlyTtl);
    expect(expiries.get("grat:budget:daily")).toBe(firstDailyTtl);
  });
});

// ---------------------------------------------------------------------------
// Reset between jobs
// ---------------------------------------------------------------------------
describe("Budget — reset between jobs", () => {
  beforeEach(() => {
    counters.clear();
    expiries.clear();
  });

  it("clearing counters restores full budget availability", async () => {
    // Drive both limits over their caps
    counters.set("grat:budget:hourly", 2000);
    counters.set("grat:budget:daily", 9000);

    let status = await getBudgetStatus();
    expect(status.allowed).toBe(false);

    // Simulate a reset (e.g. Redis key TTL fires between jobs)
    counters.clear();

    status = await getBudgetStatus();
    expect(status.allowed).toBe(true);
    expect(status.hourly_remaining).toBe(1000);
    expect(status.daily_remaining).toBe(5000);
  });

  it("resetting concurrent counter after a job restores concurrency slots", async () => {
    counters.set("grat:budget:concurrent", 2);
    expect((await getBudgetStatus()).allowed).toBe(false);

    counters.set("grat:budget:concurrent", 0);
    expect((await getBudgetStatus()).allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Concurrency semaphore
// ---------------------------------------------------------------------------
describe("Budget — concurrency semaphore", () => {
  beforeEach(() => {
    counters.clear();
  });

  it("acquireConcurrency increments the counter", async () => {
    const val = await acquireConcurrency();
    expect(val).toBe(1);
  });

  it("multiple acquires accumulate correctly", async () => {
    await acquireConcurrency();
    const val = await acquireConcurrency();
    expect(val).toBe(2);
  });

  it("releaseConcurrency decrements the counter", async () => {
    counters.set("grat:budget:concurrent", 3);
    const val = await releaseConcurrency();
    expect(val).toBe(2);
  });

  it("releaseConcurrency floors at 0", async () => {
    counters.set("grat:budget:concurrent", 0);
    const val = await releaseConcurrency();
    expect(val).toBe(0);
  });

  it("acquire then release returns to previous count", async () => {
    counters.set("grat:budget:concurrent", 1);
    await acquireConcurrency(); // → 2
    const released = await releaseConcurrency(); // → 1
    expect(released).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Concurrent tracking
// ---------------------------------------------------------------------------
describe("Budget — concurrent tracking", () => {
  beforeEach(() => {
    counters.clear();
    expiries.clear();
  });

  it("concurrent recordUsage calls accumulate correctly", async () => {
    // Fire 5 parallel record calls
    await Promise.all([
      recordUsage(100),
      recordUsage(200),
      recordUsage(300),
      recordUsage(400),
      recordUsage(500),
    ]);
    expect(counters.get("grat:budget:hourly")).toBe(1500);
    expect(counters.get("grat:budget:daily")).toBe(1500);
  });

  it("concurrent acquireConcurrency increments are all visible", async () => {
    await Promise.all([
      acquireConcurrency(),
      acquireConcurrency(),
    ]);
    expect(counters.get("grat:budget:concurrent")).toBe(2);
  });

  it("budget status reflects concurrent acquires as blocked", async () => {
    // Saturate the concurrency limit concurrently
    await Promise.all([acquireConcurrency(), acquireConcurrency()]);
    const status = await getBudgetStatus();
    expect(status.concurrent_active).toBe(2);
    expect(status.allowed).toBe(false);
  });
});
