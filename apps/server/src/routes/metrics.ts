import type { FastifyInstance } from "fastify";
import { registry, replayQueueDepth, replayQueueActive, replayQueueFailed, aiBudgetHourlyRemaining, aiBudgetDailyRemaining, aiConcurrentActive } from "../metrics";
import { replayQueue } from "../workers/queue";
import { getBudgetStatus } from "../budget/tracker";
import { getCacheStats } from "../cache/manager";
import { cacheHitsTotal, cacheMissesTotal } from "../metrics";

export async function metricsRoutes(app: FastifyInstance) {
  /**
   * GET /v1/metrics
   * Returns Prometheus-format metrics for scraping.
   * Scrapes queue depth, budget gauges, and cache counters before responding
   * so values are always current.
   */
  app.get("/v1/metrics", async (_request, reply) => {
    // Refresh queue depth gauges
    try {
      const [waiting, active, failed] = await Promise.all([
        replayQueue.getWaitingCount(),
        replayQueue.getActiveCount(),
        replayQueue.getFailedCount(),
      ]);
      replayQueueDepth.set(waiting);
      replayQueueActive.set(active);
      replayQueueFailed.set(failed);
    } catch {
      // Non-fatal: stale gauge values are better than a 500
    }

    // Refresh budget gauges
    try {
      const budget = await getBudgetStatus();
      aiBudgetHourlyRemaining.set(budget.hourly_remaining);
      aiBudgetDailyRemaining.set(budget.daily_remaining);
      aiConcurrentActive.set(budget.concurrent_active);
    } catch {
      // Non-fatal
    }

    // Sync cache counters (prom-client counters are already incremented in
    // manager.ts via the exported counter objects — we expose the snapshot
    // from getCacheStats() as a one-time sync for gauges, but the counters
    // are driven by the instrumented cache layer directly)
    const cacheStats = getCacheStats();
    // Note: cacheHitsTotal / cacheMissesTotal are Counters driven by the
    // cache manager instrumentation added below — getCacheStats() is exposed
    // for informational purposes only here.
    void cacheStats;

    const metricsOutput = await registry.metrics();
    return reply
      .header("Content-Type", registry.contentType)
      .send(metricsOutput);
  });
}
