import Redis from "ioredis";
import { randomBytes } from "crypto";
import { config } from "./config";

/**
 * How long (seconds) a session stays alive in Redis without a heartbeat.
 * Reads SESSION_TTL from config (falls back to cache.decodeTtl, then 3600s).
 */
function getSessionTtl(): number {
  return (config as any).sessionTtl ?? config.cache.decodeTtl ?? 3600;
}

export interface SessionMeta {
  /** Opaque unique identifier for this debug session. */
  sessionId: string;
  /** Short-lived bearer token the CLI uses to prove ownership. */
  token: string;
  /** Transaction hash being debugged. */
  txHash: string;
  /** Stellar network the session targets. */
  network: string;
  /** Full WebSocket URL the frontend should connect to for the live trace stream. */
  wsUrl: string;
  /** ISO timestamp of when the session was created. */
  createdAt: string;
  /** ISO timestamp of the most recent heartbeat / state update. */
  updatedAt: string;
  /** Snapshot of the latest trace state pushed by the CLI (partial – streamed incrementally over WS). */
  traceSnapshot: TraceSnapshot | null;
}

export interface TraceSnapshot {
  ledger_sequence: number;
  nodes: unknown[];
  resource_profile: ResourceProfile | null;
  state_diff: StateDiffEntry[];
  completed: boolean;
  error?: string;
}

interface ResourceProfile {
  cpu_used: number;
  memory_used: number;
  cpu_limit: number;
  memory_limit: number;
  read_bytes?: number;
  read_limit?: number;
  write_bytes?: number;
  write_limit?: number;
}

interface StateDiffEntry {
  key: string;
  before?: string;
  after?: string;
  change_type: string;
}

function redisKey(sessionId: string): string {
  return `grat:session:${sessionId}`;
}

/** Callback type invoked when a session expires while a subscriber is watching it. */
export type SessionExpiredCallback = (sessionId: string) => void;

export class SessionStore {
  private redis: Redis;
  /**
   * Subscriber client dedicated to keyspace-expiry notifications.
   * A second connection is required because a client in subscribe mode
   * cannot issue regular commands.
   */
  private subscriber: Redis | null = null;
  private expiryCallbacks = new Set<SessionExpiredCallback>();

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      // Fail fast on startup rather than silently queuing commands forever.
      enableOfflineQueue: false,
      lazyConnect: true,
    });
  }

  async connect(): Promise<void> {
    await this.redis.connect();
  }

  async disconnect(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = null;
    }
    await this.redis.quit();
  }

  // ---------------------------------------------------------------------------
  // Expiry notifications
  // ---------------------------------------------------------------------------

  /**
   * Register a callback that fires whenever a `grat:session:*` key expires in
   * Redis.  Idempotent: calling it multiple times with the same function is a
   * no-op.
   *
   * Under the hood this enables keyspace notifications on the first call and
   * opens a dedicated subscriber connection.
   */
  onExpired(cb: SessionExpiredCallback): void {
    this.expiryCallbacks.add(cb);
    this.ensureExpirySubscriber();
  }

  /** Remove a previously registered expiry callback. */
  offExpired(cb: SessionExpiredCallback): void {
    this.expiryCallbacks.delete(cb);
  }

  private ensureExpirySubscriber(): void {
    if (this.subscriber) return;

    // Reuse the same Redis URL by cloning the connection options.
    this.subscriber = this.redis.duplicate();

    this.subscriber.on("ready", async () => {
      // Enable generic keyspace events (Ex = Expired events for every key).
      // This is a best-effort CONFIG SET; if the Redis instance already has
      // notify-keyspace-events configured the command is harmless.
      try {
        await this.redis.config("SET", "notify-keyspace-events", "Ex");
      } catch {
        // Some hosted Redis instances (e.g. Upstash) forbid CONFIG SET.
        // Silently continue – expiry notifications simply won't fire.
      }

      // Subscribe to the keyevent channel for "expired" events on db 0.
      await this.subscriber!.subscribe("__keyevent@0__:expired");
    });

    this.subscriber.on("message", (_channel: string, key: string) => {
      if (!key.startsWith("grat:session:")) return;
      const sessionId = key.slice("grat:session:".length);
      for (const cb of this.expiryCallbacks) {
        try {
          cb(sessionId);
        } catch {
          // Swallow individual callback errors so one bad handler cannot
          // prevent other handlers from running.
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  /**
   * Create a brand-new session and persist it in Redis.
   * Returns the full SessionMeta including the generated token.
   */
  async create(opts: {
    txHash: string;
    network: string;
    wsUrl: string;
  }): Promise<SessionMeta> {
    const sessionId = randomBytes(16).toString("hex");
    const token = randomBytes(32).toString("hex");
    const now = new Date().toISOString();

    const meta: SessionMeta = {
      sessionId,
      token,
      txHash: opts.txHash,
      network: opts.network,
      wsUrl: opts.wsUrl,
      createdAt: now,
      updatedAt: now,
      traceSnapshot: null,
    };

    await this.redis.set(
      redisKey(sessionId),
      JSON.stringify(meta),
      "EX",
      getSessionTtl(),
    );

    return meta;
  }

  /**
   * Retrieve a session by ID.  Returns null when the session does not exist or
   * has expired.
   */
  async get(sessionId: string): Promise<SessionMeta | null> {
    const raw = await this.redis.get(redisKey(sessionId));
    if (!raw) return null;
    return JSON.parse(raw) as SessionMeta;
  }

  /**
   * Persist an updated trace snapshot and refresh the TTL so active sessions
   * do not expire while the CLI is still streaming.
   */
  async updateSnapshot(
    sessionId: string,
    snapshot: TraceSnapshot,
  ): Promise<boolean> {
    const meta = await this.get(sessionId);
    if (!meta) return false;

    meta.traceSnapshot = snapshot;
    meta.updatedAt = new Date().toISOString();

    await this.redis.set(
      redisKey(sessionId),
      JSON.stringify(meta),
      "EX",
      getSessionTtl(),
    );
    return true;
  }

  /**
   * Extend the TTL without changing any data (heartbeat from the CLI).
   */
  async touch(sessionId: string): Promise<boolean> {
    const result = await this.redis.expire(
      redisKey(sessionId),
      getSessionTtl(),
    );
    return result === 1;
  }

  /**
   * Remove a session immediately (e.g. CLI closes the debug session).
   */
  async delete(sessionId: string): Promise<boolean> {
    const result = await this.redis.del(redisKey(sessionId));
    return result === 1;
  }

  /**
   * Verify that a bearer token matches the stored token for the given session.
   * Constant-time comparison prevents timing attacks.
   */
  async verifyToken(sessionId: string, token: string): Promise<boolean> {
    const meta = await this.get(sessionId);
    if (!meta) return false;

    // timingSafeEqual requires same-length buffers.
    const { timingSafeEqual } = await import("crypto");
    const a = Buffer.from(meta.token);
    const b = Buffer.from(token);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
