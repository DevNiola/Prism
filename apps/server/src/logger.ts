import { config } from "./config";

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

const LEVEL_WEIGHTS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

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
      ...meta,
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
