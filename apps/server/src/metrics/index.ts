import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from "prom-client";

/**
 * Dedicated Prometheus registry — isolated from the default global registry
 * so test code and multiple imports don't double-register metrics.
 */
export const registry = new Registry();

// Register default Node.js runtime metrics (event loop lag, GC, heap, etc.)
collectDefaultMetrics({ register: registry });

// ---------------------------------------------------------------------------
// HTTP request metrics
// ---------------------------------------------------------------------------

export const httpRequestsTotal = new Counter({
  name: "prism_http_requests_total",
  help: "Total number of HTTP requests handled, by route and status code.",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [registry],
});

export const httpRequestDurationSeconds = new Histogram({
  name: "prism_http_request_duration_seconds",
  help: "HTTP request latency in seconds, by route.",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Replay queue metrics
// ---------------------------------------------------------------------------

export const replayQueueDepth = new Gauge({
  name: "prism_replay_queue_depth",
  help: "Number of replay jobs currently waiting in the queue.",
  registers: [registry],
});

export const replayQueueActive = new Gauge({
  name: "prism_replay_queue_active",
  help: "Number of replay jobs currently being processed.",
  registers: [registry],
});

export const replayQueueFailed = new Gauge({
  name: "prism_replay_queue_failed",
  help: "Number of replay jobs in the failed set.",
  registers: [registry],
});

// ---------------------------------------------------------------------------
// Cache metrics
// ---------------------------------------------------------------------------

export const cacheHitsTotal = new Counter({
  name: "prism_cache_hits_total",
  help: "Total number of cache hits.",
  registers: [registry],
});

export const cacheMissesTotal = new Counter({
  name: "prism_cache_misses_total",
  help: "Total number of cache misses.",
  registers: [registry],
});

// ---------------------------------------------------------------------------
// AI / token budget metrics
// ---------------------------------------------------------------------------

export const aiTokensUsedTotal = new Counter({
  name: "prism_ai_tokens_used_total",
  help: "Total AI tokens consumed since process start.",
  registers: [registry],
});

export const aiRequestsTotal = new Counter({
  name: "prism_ai_requests_total",
  help: "Total AI requests made, by result (success | budget_exceeded | error).",
  labelNames: ["result"] as const,
  registers: [registry],
});

export const aiBudgetHourlyRemaining = new Gauge({
  name: "prism_ai_budget_hourly_remaining_tokens",
  help: "AI tokens remaining in the current hourly budget window.",
  registers: [registry],
});

export const aiBudgetDailyRemaining = new Gauge({
  name: "prism_ai_budget_daily_remaining_tokens",
  help: "AI tokens remaining in the current daily budget window.",
  registers: [registry],
});

export const aiConcurrentActive = new Gauge({
  name: "prism_ai_concurrent_active",
  help: "Number of AI requests currently in flight.",
  registers: [registry],
});

// ---------------------------------------------------------------------------
// WebSocket client metrics
// ---------------------------------------------------------------------------

export const wsClientsActive = new Gauge({
  name: "prism_ws_clients_active",
  help: "Number of active WebSocket clients connected to the trace stream.",
  registers: [registry],
});
