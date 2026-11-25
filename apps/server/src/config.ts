export const config = {
  port: Number(process.env.PORT) || 3001,
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  gratBinaryPath: process.env.GRAT_BINARY || "grat",

  // AI provider
  ai: {
    apiKey: process.env.AI_API_KEY || "",
    apiBaseUrl: process.env.AI_API_BASE_URL || "https://api.openai.com/v1",
    model: process.env.AI_MODEL || "gpt-4o-mini",
    maxTokensPerRequest: Number(process.env.AI_MAX_TOKENS_PER_REQUEST) || 2048,
    temperature: Number(process.env.AI_TEMPERATURE) || 0.2,
    timeoutMs: Number(process.env.AI_TIMEOUT_MS) || 30_000,
  },

  // Token budget enforcement
  budget: {
    hourlyTokenLimit: Number(process.env.AI_HOURLY_TOKEN_LIMIT) || 100_000,
    dailyTokenLimit: Number(process.env.AI_DAILY_TOKEN_LIMIT) || 1_000_000,
    maxConcurrentRequests: Number(process.env.AI_MAX_CONCURRENT) || 5,
  },

  // Cache TTLs (seconds)
  cache: {
    decodeTtl: Number(process.env.CACHE_DECODE_TTL) || 86_400, // 24h
    profileTtl: Number(process.env.CACHE_PROFILE_TTL) || 3_600, // 1h
    dedupWindowMs: Number(process.env.DEDUP_WINDOW_MS) || 10_000, // 10s
  },

  // Replay worker
  replay: {
    /**
     * Hard timeout for a single replay run (ms).  Aligned with AI_TIMEOUT_MS
     * so the replay and its subsequent AI explanation share the same deadline.
     * Override independently with REPLAY_TIMEOUT_MS.
     */
    timeoutMs:
      Number(process.env.REPLAY_TIMEOUT_MS) ||
      Number(process.env.AI_TIMEOUT_MS) ||
      30_000,
  },
};
