import fs from "node:fs";
import path from "node:path";

/**
 * Loads environment variables from hierarchical .env files:
 * 1. .env.{NODE_ENV}.local
 * 2. .env.local
 * 3. .env.{NODE_ENV} (e.g. .env.production, .env.development)
 * 4. .env
 *
 * Pre-existing process.env variables always take precedence.
 */
export function loadEnvFiles(baseDir: string = process.cwd()): string[] {
  const nodeEnv = process.env.NODE_ENV || "development";
  const filesToTry = [
    `.env.${nodeEnv}.local`,
    ".env.local",
    `.env.${nodeEnv}`,
    ".env",
  ];

  const loadedFiles: string[] = [];

  for (const filename of filesToTry) {
    const fullPath = path.resolve(baseDir, filename);
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eqIdx = trimmed.indexOf("=");
          if (eqIdx !== -1) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if (
              (val.startsWith('"') && val.endsWith('"')) ||
              (val.startsWith("'") && val.endsWith("'"))
            ) {
              val = val.slice(1, -1);
            }
            if (!(key in process.env)) {
              process.env[key] = val;
            }
          }
        }
        loadedFiles.push(filename);
      } catch {
        // Ignore read errors gracefully
      }
    }
  }

  return loadedFiles;
}

// Bootstrap environment files immediately upon module import
loadEnvFiles();

export interface AIConfig {
  apiKey: string;
  apiBaseUrl: string;
  model: string;
  maxTokensPerRequest: number;
  temperature: number;
  timeoutMs: number;
}

export interface BudgetConfig {
  hourlyTokenLimit: number;
  dailyTokenLimit: number;
  maxConcurrentRequests: number;
}

export interface CacheConfig {
  decodeTtl: number;
  profileTtl: number;
  dedupWindowMs: number;
}

export interface AppConfig {
  port: number;
  redisUrl: string;
  gratBinaryPath: string;
  nodeEnv: string;
  ai: AIConfig;
  budget: BudgetConfig;
  cache: CacheConfig;
}

export const config: AppConfig = {
  port: Number(process.env.PORT) || 3001,
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  gratBinaryPath: process.env.GRAT_BINARY || "grat",
  nodeEnv: process.env.NODE_ENV || "development",

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

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates configuration values and required environment variables.
 */
export function validateConfig(cfg: AppConfig = config): ValidationResult {
  const errors: string[] = [];

  // Port validation
  if (isNaN(cfg.port) || cfg.port < 1 || cfg.port > 65535 || !Number.isInteger(cfg.port)) {
    errors.push(`Invalid PORT: must be an integer between 1 and 65535, received '${cfg.port}'`);
  }

  // Redis URL validation
  if (!cfg.redisUrl || (!cfg.redisUrl.startsWith("redis://") && !cfg.redisUrl.startsWith("rediss://"))) {
    errors.push(`Invalid REDIS_URL: must start with 'redis://' or 'rediss://', received '${cfg.redisUrl}'`);
  }

  // AI configuration validation
  if (cfg.ai.apiKey && !cfg.ai.apiBaseUrl) {
    errors.push("Missing AI_API_BASE_URL: required when AI_API_KEY is configured");
  }

  if (isNaN(cfg.ai.maxTokensPerRequest) || cfg.ai.maxTokensPerRequest <= 0) {
    errors.push(`Invalid AI_MAX_TOKENS_PER_REQUEST: must be > 0, received '${cfg.ai.maxTokensPerRequest}'`);
  }

  if (isNaN(cfg.ai.temperature) || cfg.ai.temperature < 0 || cfg.ai.temperature > 2) {
    errors.push(`Invalid AI_TEMPERATURE: must be between 0.0 and 2.0, received '${cfg.ai.temperature}'`);
  }

  // Budget validation
  if (isNaN(cfg.budget.hourlyTokenLimit) || cfg.budget.hourlyTokenLimit <= 0) {
    errors.push(`Invalid AI_HOURLY_TOKEN_LIMIT: must be > 0, received '${cfg.budget.hourlyTokenLimit}'`);
  }

  if (isNaN(cfg.budget.dailyTokenLimit) || cfg.budget.dailyTokenLimit <= 0) {
    errors.push(`Invalid AI_DAILY_TOKEN_LIMIT: must be > 0, received '${cfg.budget.dailyTokenLimit}'`);
  }

  if (isNaN(cfg.budget.maxConcurrentRequests) || cfg.budget.maxConcurrentRequests <= 0) {
    errors.push(`Invalid AI_MAX_CONCURRENT: must be > 0, received '${cfg.budget.maxConcurrentRequests}'`);
  }

  // Cache validation
  if (isNaN(cfg.cache.decodeTtl) || cfg.cache.decodeTtl < 0) {
    errors.push(`Invalid CACHE_DECODE_TTL: must be >= 0, received '${cfg.cache.decodeTtl}'`);
  }

  if (isNaN(cfg.cache.profileTtl) || cfg.cache.profileTtl < 0) {
    errors.push(`Invalid CACHE_PROFILE_TTL: must be >= 0, received '${cfg.cache.profileTtl}'`);
  }

  if (isNaN(cfg.cache.dedupWindowMs) || cfg.cache.dedupWindowMs < 0) {
    errors.push(`Invalid DEDUP_WINDOW_MS: must be >= 0, received '${cfg.cache.dedupWindowMs}'`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Asserts configuration is valid, throwing a descriptive error if invalid.
 */
export function assertValidConfig(cfg: AppConfig = config): void {
  const result = validateConfig(cfg);
  if (!result.valid) {
    const errorMsg = `Configuration validation failed with ${result.errors.length} error(s):\n${result.errors.map((e) => `  - ${e}`).join("\n")}`;
    throw new Error(errorMsg);
  }
}

// Support CLI execution: node/tsx src/config.ts --validate or config:validate
if (
  process.argv.includes("--validate") ||
  process.argv.includes("config:validate") ||
  process.argv.includes("-v")
) {
  const result = validateConfig();
  if (result.valid) {
    console.log("Configuration validation successful: all configuration parameters are nominal.");
    process.exit(0);
  } else {
    console.error(`Configuration validation failed with ${result.errors.length} error(s):`);
    result.errors.forEach((err) => console.error(`  [ERROR] ${err}`));
    process.exit(1);
  }
}
