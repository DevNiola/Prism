export const config = {
  port: Number(process.env.PORT) || 3001,
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  gratBinaryPath: process.env.GRAT_BINARY || "grat",

  // Session authentication
  auth: {
    /**
     * Secret used to sign and verify HS256 JWTs.
     * Must be set in production — the startup guard enforces this.
     */
    jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me",
    /**
     * When true, JWT validation on protected routes is skipped.
     * Allowed only in non-production environments.
     */
    disableSessionAuth: process.env.DISABLE_SESSION_AUTH === "true",
    /**
     * How long (seconds) an issued JWT remains valid.
     * Default: 1 hour.
     */
    jwtExpirySeconds: Number(process.env.JWT_EXPIRY_SECONDS) || 3_600,
    /**
     * Sliding-window refresh threshold (seconds).  A token is eligible for
     * refresh when fewer than this many seconds remain before it expires.
     * Default: 15 minutes.
     */
    jwtRefreshThresholdSeconds:
      Number(process.env.JWT_REFRESH_THRESHOLD_SECONDS) || 900,
  },

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
};
