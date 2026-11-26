import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { config } from "../config";
import { logger } from "../logger";
import { incrBy, decrBy, getNumber, setExpiry } from "../redis";
import {
  BudgetExceededError,
  BudgetWarningError,
  ConcurrencyLimitError,
} from "./errors";
import type { BudgetStatus } from "../ai/types";
import { aiTokensUsedTotal, aiRequestsTotal } from "../metrics";

// ---------------------------------------------------------------------------
// Redis key constants
// ---------------------------------------------------------------------------
const HOURLY_KEY = "grat:budget:hourly";
const DAILY_KEY = "grat:budget:daily";
const CONCURRENT_KEY = "grat:budget:concurrent";

export const budgetWarningEmitter = new EventEmitter();

interface ResourceUsage {
  cpu_used: number;
  memory_used: number;
  cpu_limit: number;
  memory_limit: number;
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/** Seconds remaining until the top of the next hour. */
function secondsUntilNextHour(): number {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return Math.ceil((next.getTime() - now.getTime()) / 1000);
}

/** Seconds remaining until midnight UTC. */
function secondsUntilMidnightUTC(): number {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  return Math.ceil((tomorrow.getTime() - now.getTime()) / 1000);
}

function hourlyResetDate(): Date {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

function dailyResetDate(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// ---------------------------------------------------------------------------
// Budget enforcement
// ---------------------------------------------------------------------------

/**
 * Pre-flight check: is a new AI request allowed given current usage?
 * Throws `BudgetExceededError` or `ConcurrencyLimitError` when limits are hit.
 */
export async function assertBudgetAvailable(): Promise<void> {
  const status = await getBudgetStatus();

  if (!status.allowed) {
    if (status.concurrent_active >= status.concurrent_limit) {
      aiRequestsTotal.inc({ result: "budget_exceeded" });
      throw new ConcurrencyLimitError(
        status.concurrent_active,
        status.concurrent_limit,
      );
    }
    aiRequestsTotal.inc({ result: "budget_exceeded" });
    throw new BudgetExceededError({
      hourlyRemaining: status.hourly_remaining,
      dailyRemaining: status.daily_remaining,
      resetAt:
        status.hourly_remaining <= 0
          ? new Date(status.hourly_reset_at)
          : new Date(status.daily_reset_at),
    });
  }
}

/**
 * Return current budget status without throwing.
 */
export async function getBudgetStatus(): Promise<BudgetStatus> {
  const [hourlyUsed, dailyUsed, concurrent] = await Promise.all([
    getNumber(HOURLY_KEY),
    getNumber(DAILY_KEY),
    getNumber(CONCURRENT_KEY),
  ]);

  const { hourlyTokenLimit, dailyTokenLimit, maxConcurrentRequests } =
    config.budget;

  const hourlyRemaining = Math.max(0, hourlyTokenLimit - hourlyUsed);
  const dailyRemaining = Math.max(0, dailyTokenLimit - dailyUsed);

  const allowed =
    hourlyRemaining > 0 &&
    dailyRemaining > 0 &&
    concurrent < maxConcurrentRequests;

  return {
    allowed,
    hourly_remaining: hourlyRemaining,
    daily_remaining: dailyRemaining,
    concurrent_active: concurrent,
    concurrent_limit: maxConcurrentRequests,
    hourly_reset_at: hourlyResetDate().toISOString(),
    daily_reset_at: dailyResetDate().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Recording usage
// ---------------------------------------------------------------------------

/**
 * Record `tokensUsed` against the hourly and daily counters.
 * Automatically sets expiry on first write so counters reset naturally.
 */
export async function recordUsage(tokensUsed: number): Promise<void> {
  const [hourlyNew, dailyNew] = await Promise.all([
    incrBy(HOURLY_KEY, tokensUsed),
    incrBy(DAILY_KEY, tokensUsed),
  ]);

  // Set expiry on first increment (counter was 0 before this write).
  if (hourlyNew === tokensUsed) {
    await setExpiry(HOURLY_KEY, secondsUntilNextHour());
  }
  if (dailyNew === tokensUsed) {
    await setExpiry(DAILY_KEY, secondsUntilMidnightUTC());
  }

  aiTokensUsedTotal.inc(tokensUsed);
  aiRequestsTotal.inc({ result: "success" });
}

// ---------------------------------------------------------------------------
// Concurrency semaphore
// ---------------------------------------------------------------------------

/**
 * Increment the concurrent-request counter. Call `releaseConcurrency()`
 * when the request finishes.
 */
export async function acquireConcurrency(): Promise<number> {
  return incrBy(CONCURRENT_KEY, 1);
}

/**
 * Decrement the concurrent-request counter.
 * Floors at 0 to avoid drift from crash scenarios.
 */
export async function releaseConcurrency(): Promise<number> {
  const val = await decrBy(CONCURRENT_KEY, 1);
  return Math.max(0, val);
}

export async function checkReplayBudget(
  txHash: string,
  usage: ResourceUsage,
  previousUsage?: ResourceUsage | null,
): Promise<void> {
  const checks = [
    {
      resource: "cpu" as const,
      used: usage.cpu_used,
      limit: usage.cpu_limit,
      previousUsed: previousUsage?.cpu_used,
      previousLimit: previousUsage?.cpu_limit,
      threshold: config.budget.cpuWarningThresholdPercent,
    },
    {
      resource: "memory" as const,
      used: usage.memory_used,
      limit: usage.memory_limit,
      previousUsed: previousUsage?.memory_used,
      previousLimit: previousUsage?.memory_limit,
      threshold: config.budget.memoryWarningThresholdPercent,
    },
  ];

  for (const check of checks) {
    if (check.limit <= 0 || (check.used / check.limit) * 100 < check.threshold) {
      continue;
    }

    if (
      previousUsage &&
      check.previousLimit &&
      check.previousUsed !== undefined &&
      (check.previousUsed / check.previousLimit) * 100 >= check.threshold
    ) {
      continue;
    }

    const warning = new BudgetWarningError({
      txHash,
      resource: check.resource,
      used: check.used,
      limit: check.limit,
      thresholdPercent: check.threshold,
    });
    budgetWarningEmitter.emit("warning", warning);

    if (config.budget.alertWebhookUrl) {
      try {
        const response = await fetch(config.budget.alertWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tx_hash: warning.tx_hash,
            resource: warning.resource,
            usage: {
              used: warning.used,
              limit: warning.limit,
              percent: warning.usage_percent,
            },
            threshold_percent: warning.threshold_percent,
          }),
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) {
          logger.warn(`Budget alert webhook returned HTTP ${response.status}`, {
            status: response.status,
          });
        }
      } catch (error) {
        logger.warn("Budget alert webhook delivery failed", {
          error: String(error),
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Per-API-key budget tracking
// ---------------------------------------------------------------------------

/**
 * Returns the first 16 hex characters of the SHA-256 hash of the given API key.
 * Used for safe logging and Redis key naming.
 */
export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

function perKeyHourlyRedisKey(hashedKey: string): string {
  return `grat:budget:key:${hashedKey}:hourly`;
}

function perKeyDailyRedisKey(hashedKey: string): string {
  return `grat:budget:key:${hashedKey}:daily`;
}

/**
 * Fire a webhook for a per-key budget event (warning or exceeded).
 */
async function emitPerKeyWebhook(
  event: "per_key_budget_warning" | "per_key_budget_exceeded",
  apiKeyHash: string,
  bucket: "hourly" | "daily",
  used: number,
  limit: number,
  resetAt: string,
): Promise<void> {
  if (!config.budget.alertWebhookUrl) {
    return;
  }
  const percent = (used / limit) * 100;
  try {
    const response = await fetch(config.budget.alertWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        api_key_hash: apiKeyHash,
        bucket,
        used,
        limit,
        percent,
        reset_at: resetAt,
      }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      logger.warn(`Per-key budget webhook returned HTTP ${response.status}`, {
        status: response.status,
        event,
      });
    }
  } catch (error) {
    logger.warn("Per-key budget webhook delivery failed", {
      error: String(error),
      event,
    });
  }
}

/**
 * Returns the per-key budget status for a given API key.
 */
export async function getKeyBudgetStatus(apiKey: string): Promise<{
  hourly_used: number;
  daily_used: number;
  hourly_remaining: number;
  daily_remaining: number;
  hourly_reset_at: string;
  daily_reset_at: string;
}> {
  const hashedKey = hashApiKey(apiKey);
  const [hourlyUsed, dailyUsed] = await Promise.all([
    getNumber(perKeyHourlyRedisKey(hashedKey)),
    getNumber(perKeyDailyRedisKey(hashedKey)),
  ]);

  const { perKeyHourlyTokenLimit, perKeyDailyTokenLimit } = config.budget;

  return {
    hourly_used: hourlyUsed,
    daily_used: dailyUsed,
    hourly_remaining: Math.max(0, perKeyHourlyTokenLimit - hourlyUsed),
    daily_remaining: Math.max(0, perKeyDailyTokenLimit - dailyUsed),
    hourly_reset_at: hourlyResetDate().toISOString(),
    daily_reset_at: dailyResetDate().toISOString(),
  };
}

/**
 * Pre-flight check: is a new AI request allowed for the given API key?
 * Also enforces the global budget via `assertBudgetAvailable()`.
 * Throws `BudgetExceededError` (with `retryAfterSeconds`) when a per-key limit is hit.
 */
export async function assertBudgetAvailableForKey(
  apiKey: string,
): Promise<void> {
  // Global check first
  await assertBudgetAvailable();

  const hashedKey = hashApiKey(apiKey);
  const [hourlyUsed, dailyUsed] = await Promise.all([
    getNumber(perKeyHourlyRedisKey(hashedKey)),
    getNumber(perKeyDailyRedisKey(hashedKey)),
  ]);

  const {
    perKeyHourlyTokenLimit: hourlyLimit,
    perKeyDailyTokenLimit: dailyLimit,
  } = config.budget;

  if (hourlyUsed >= hourlyLimit) {
    const retryAfterSeconds = secondsUntilNextHour();
    throw new BudgetExceededError({
      hourlyRemaining: 0,
      dailyRemaining: Math.max(0, dailyLimit - dailyUsed),
      resetAt: hourlyResetDate(),
      retryAfterSeconds,
    });
  }

  if (dailyUsed >= dailyLimit) {
    const retryAfterSeconds = secondsUntilMidnightUTC();
    throw new BudgetExceededError({
      hourlyRemaining: Math.max(0, hourlyLimit - hourlyUsed),
      dailyRemaining: 0,
      resetAt: dailyResetDate(),
      retryAfterSeconds,
    });
  }
}

/**
 * Record `tokensUsed` against the per-key hourly and daily counters.
 * Emits webhook alerts when usage crosses the warning (80%) or limit (100%) threshold.
 */
export async function recordUsageForKey(
  apiKey: string,
  tokensUsed: number,
): Promise<void> {
  const hashedKey = hashApiKey(apiKey);
  const hourlyKey = perKeyHourlyRedisKey(hashedKey);
  const dailyKey = perKeyDailyRedisKey(hashedKey);

  const [hourlyNew, dailyNew] = await Promise.all([
    incrBy(hourlyKey, tokensUsed),
    incrBy(dailyKey, tokensUsed),
  ]);

  // Set expiry on first write so counters reset naturally.
  if (hourlyNew === tokensUsed) {
    await setExpiry(hourlyKey, secondsUntilNextHour());
  }
  if (dailyNew === tokensUsed) {
    await setExpiry(dailyKey, secondsUntilMidnightUTC());
  }

  const {
    perKeyHourlyTokenLimit: hourlyLimit,
    perKeyDailyTokenLimit: dailyLimit,
  } = config.budget;
  const WARNING_THRESHOLD = 80;

  // Check hourly bucket
  const hourlyPercent = (hourlyNew / hourlyLimit) * 100;
  if (hourlyNew >= hourlyLimit) {
    await emitPerKeyWebhook(
      "per_key_budget_exceeded",
      hashedKey,
      "hourly",
      hourlyNew,
      hourlyLimit,
      hourlyResetDate().toISOString(),
    );
  } else if (hourlyPercent >= WARNING_THRESHOLD) {
    await emitPerKeyWebhook(
      "per_key_budget_warning",
      hashedKey,
      "hourly",
      hourlyNew,
      hourlyLimit,
      hourlyResetDate().toISOString(),
    );
  }

  // Check daily bucket
  const dailyPercent = (dailyNew / dailyLimit) * 100;
  if (dailyNew >= dailyLimit) {
    await emitPerKeyWebhook(
      "per_key_budget_exceeded",
      hashedKey,
      "daily",
      dailyNew,
      dailyLimit,
      dailyResetDate().toISOString(),
    );
  } else if (dailyPercent >= WARNING_THRESHOLD) {
    await emitPerKeyWebhook(
      "per_key_budget_warning",
      hashedKey,
      "daily",
      dailyNew,
      dailyLimit,
      dailyResetDate().toISOString(),
    );
  }
}
