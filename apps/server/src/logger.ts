import { config } from "./config";

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

const LEVEL_WEIGHTS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

/**
 * Header and field names that must never appear in log output.
 * Matching is case-insensitive and covers both HTTP header keys and
 * arbitrary metadata field names (e.g. `ai_api_key` passed in a meta object).
 */
export const REDACTED_KEYS = [
  "authorization",
  "cookie",
  "set-cookie",
  "ai_api_key",
  "jwt_secret",
  "token",
  "x-api-key",
  "x-auth-token",
  "password",
  "secret",
];

const REDACTED_PLACEHOLDER = "[REDACTED]";

/**
 * Recursively walk `value` and replace any object key whose name appears in
 * REDACTED_KEYS with REDACTED_PLACEHOLDER.  Returns a new object; the
 * original is never mutated.
 */
export function redactSensitiveFields(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(redactSensitiveFields);
  }

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (REDACTED_KEYS.includes(k.toLowerCase())) {
      result[k] = REDACTED_PLACEHOLDER;
    } else {
      result[k] = redactSensitiveFields(v);
    }
  }
  return result;
}

export class StructuredLogger {
  private currentLevel: LogLevel;

  constructor() {
    this.currentLevel = (process.env.LOG_LEVEL as LogLevel) || "info";
  }

  public setLevel(level: LogLevel) {
    this.currentLevel = level;
  }

  public getLevel(): LogLevel {
    return this.currentLevel;
  }

  private shouldLog(level: LogLevel): boolean {
    const minWeight = LEVEL_WEIGHTS[this.currentLevel] ?? 20;
    const currentWeight = LEVEL_WEIGHTS[level] ?? 20;
    return currentWeight >= minWeight;
  }

  private write(level: LogLevel, message: string, meta: Record<string, unknown> = {}) {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry = {
      level,
      time: new Date().toISOString(),
      msg: message,
      ...(redactSensitiveFields(meta) as Record<string, unknown>),
    };

    const serialized = JSON.stringify(entry);
    if (level === "error" || level === "fatal") {
      process.stderr.write(serialized + "\n");
    } else {
      process.stdout.write(serialized + "\n");
    }
  }

  public debug(message: string, meta?: Record<string, unknown>) {
    this.write("debug", message, meta);
  }

  public info(message: string, meta?: Record<string, unknown>) {
    this.write("info", message, meta);
  }

  public warn(message: string, meta?: Record<string, unknown>) {
    this.write("warn", message, meta);
  }

  public error(message: string, meta?: Record<string, unknown>) {
    this.write("error", message, meta);
  }

  public fatal(message: string, meta?: Record<string, unknown>) {
    this.write("fatal", message, meta);
  }

  public child(bindings: Record<string, unknown>) {
    return {
      debug: (msg: string, meta: Record<string, unknown> = {}) =>
        this.debug(msg, { ...bindings, ...meta }),
      info: (msg: string, meta: Record<string, unknown> = {}) =>
        this.info(msg, { ...bindings, ...meta }),
      warn: (msg: string, meta: Record<string, unknown> = {}) =>
        this.warn(msg, { ...bindings, ...meta }),
      error: (msg: string, meta: Record<string, unknown> = {}) =>
        this.error(msg, { ...bindings, ...meta }),
      fatal: (msg: string, meta: Record<string, unknown> = {}) =>
        this.fatal(msg, { ...bindings, ...meta }),
    };
  }
}

export const logger = new StructuredLogger();
