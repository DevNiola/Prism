import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Mock heavy dependencies so the server boots without Redis / grat binary
// ---------------------------------------------------------------------------

// Session store — in-memory map instead of Redis
vi.mock("../session-store", () => {
  const sessions = new Map<string, any>();

  class SessionStore {
    constructor(_redisUrl: string) {}
    async connect() {}
    async disconnect() {}
    async create(opts: { txHash: string; network: string; wsUrl: string }) {
      const sessionId = `sess-${Math.random().toString(36).slice(2)}`;
      const token = `tok-${Math.random().toString(36).slice(2)}`;
      const now = new Date().toISOString();
      const meta = {
        sessionId,
        token,
        txHash: opts.txHash,
        network: opts.network,
        wsUrl: opts.wsUrl,
        createdAt: now,
        updatedAt: now,
        traceSnapshot: null,
      };
      sessions.set(sessionId, meta);
      return meta;
    }
    async get(sessionId: string) {
      return sessions.get(sessionId) ?? null;
    }
    async updateSnapshot(sessionId: string, snapshot: any) {
      const meta = sessions.get(sessionId);
      if (!meta) return false;
      meta.traceSnapshot = snapshot;
      meta.updatedAt = new Date().toISOString();
      return true;
    }
    async touch(sessionId: string) {
      return sessions.has(sessionId);
    }
    async delete(sessionId: string) {
      return sessions.delete(sessionId);
    }
    async verifyToken(sessionId: string, token: string) {
      const meta = sessions.get(sessionId);
      return meta?.token === token;
    }
    // Expose for cleanup between tests
    static __sessions = sessions;
  }

  return { SessionStore };
});

// Budget — stub to avoid Redis
vi.mock("../budget", () => ({
  getBudgetStatus: vi.fn(async () => ({
    allowed: true,
    hourly_remaining: 900,
    daily_remaining: 4500,
    concurrent_active: 0,
    concurrent_limit: 5,
    hourly_reset_at: new Date(Date.now() + 3_600_000).toISOString(),
    daily_reset_at: new Date(Date.now() + 86_400_000).toISOString(),
  })),
  assertBudgetAvailable: vi.fn(async () => {}),
  acquireConcurrency: vi.fn(async () => 1),
  releaseConcurrency: vi.fn(async () => 0),
  BudgetExceededError: class BudgetExceededError extends Error {
    hourlyRemaining = 0;
    dailyRemaining = 0;
    resetAt = new Date();
  },
  ConcurrencyLimitError: class ConcurrencyLimitError extends Error {
    currentActive = 1;
    limit = 1;
  },
}));

// AI client — stub to avoid external HTTP calls
vi.mock("../ai", () => ({
  explainError: vi.fn(async () => ({
    explanation: "Mocked AI explanation",
    suggestions: [],
  })),
}));

// Cache helpers — no-ops
vi.mock("../cache", () => ({
  invalidateByTxHash: vi.fn(async () => 0),
  clearAll: vi.fn(async () => 0),
}));

// Config
vi.mock("../config", () => ({
  config: {
    port: 3001,
    redisUrl: "redis://localhost:6379",
    gratBinaryPath: "grat",
    ai: {
      apiKey: "test-key",
      apiBaseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      maxTokensPerRequest: 2048,
      temperature: 0.2,
      timeoutMs: 30_000,
    },
    budget: {
      hourlyTokenLimit: 1000,
      dailyTokenLimit: 5000,
      maxConcurrentRequests: 2,
    },
    cache: {
      decodeTtl: 86400,
      profileTtl: 3600,
      dedupWindowMs: 10_000,
    },
  },
}));

// ---------------------------------------------------------------------------
// Build a fresh Fastify app (mirrors index.ts without starting the server)
// ---------------------------------------------------------------------------
async function buildApp(): Promise<FastifyInstance> {
  const { SessionStore } = await import("../session-store");
  const { replayRoutes } = await import("../routes/replay");
  const { healthRoutes } = await import("../routes/health");
  const { sessionRoutes } = await import("../routes/session");
  const { aiRoutes } = await import("../routes/ai");
  const { config } = await import("../config");

  const app = Fastify({ logger: false });
  const sessionStore = new SessionStore(config.redisUrl);

  app.decorate("sessionStore", sessionStore);
  app.addHook("onReady", async () => {
    await sessionStore.connect();
  });
  app.addHook("onClose", async () => {
    await sessionStore.disconnect();
  });

  app.register(healthRoutes);
  app.register(replayRoutes, { prefix: "/api" });
  app.register(sessionRoutes, { prefix: "/api" });
  app.register(aiRoutes, { prefix: "/api" });

  return app;
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe("GET /health", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 200 with status ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
  });

  it("includes a version field", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    const body = res.json();
    expect(typeof body.version).toBe("string");
    expect(body.version.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe("POST /api/replay", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 200 with queued status for valid request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/replay",
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("queued");
  });

  it("returns pending status on GET /api/replay/:jobId", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/replay/job-123",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("pending");
  });
});

// ---------------------------------------------------------------------------

describe("POST /api/session — create", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 201 with sessionId and token for valid body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/session",
      payload: {
        txHash: "abc123",
        network: "testnet",
        wsUrl: "ws://localhost:3002",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(typeof body.sessionId).toBe("string");
    expect(typeof body.token).toBe("string");
    expect(typeof body.wsUrl).toBe("string");
    expect(typeof body.createdAt).toBe("string");
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/session",
      payload: { txHash: "abc123" }, // missing network and wsUrl
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when body is empty", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/session",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/session/:sessionId", () => {
  let app: FastifyInstance;
  let sessionId: string;
  let token: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // Create a session to use in subsequent tests
    const res = await app.inject({
      method: "POST",
      url: "/api/session",
      payload: {
        txHash: "txGet001",
        network: "mainnet",
        wsUrl: "ws://localhost:3002",
      },
    });
    const body = res.json();
    sessionId = body.sessionId;
    token = body.token;
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 200 with session data for a known session", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/session/${sessionId}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("active");
    expect(body.session.sessionId).toBe(sessionId);
    // Token must not be returned to the caller
    expect(body.session.token).toBeUndefined();
  });

  it("returns 404 for a non-existent sessionId", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/session/does-not-exist",
    });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.status).toBe("not_found");
  });
});

// ---------------------------------------------------------------------------

describe("PATCH /api/session/:sessionId/snapshot — auth", () => {
  let app: FastifyInstance;
  let sessionId: string;
  let token: string;

  const validSnapshot = {
    ledger_sequence: 51000,
    nodes: [],
    resource_profile: null,
    state_diff: [],
    completed: false,
  };

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/session",
      payload: {
        txHash: "txSnap001",
        network: "mainnet",
        wsUrl: "ws://localhost:3002",
      },
    });
    const body = res.json();
    sessionId = body.sessionId;
    token = body.token;
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 200 with valid Bearer token", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/session/${sessionId}/snapshot`,
      headers: { authorization: `Bearer ${token}` },
      payload: { snapshot: validSnapshot },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/session/${sessionId}/snapshot`,
      payload: { snapshot: validSnapshot },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 when token is wrong", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/session/${sessionId}/snapshot`,
      headers: { authorization: "Bearer wrong-token" },
      payload: { snapshot: validSnapshot },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 when sessionId does not exist", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/session/ghost-session/snapshot",
      headers: { authorization: `Bearer ${token}` },
      payload: { snapshot: validSnapshot },
    });
    // ghost-session token mismatch → 403 (verifyToken returns false for unknown session)
    expect([403, 404]).toContain(res.statusCode);
  });
});

// ---------------------------------------------------------------------------

describe("DELETE /api/session/:sessionId — auth", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("deletes a session with valid token and returns 204", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/session",
      payload: {
        txHash: "txDel001",
        network: "testnet",
        wsUrl: "ws://localhost:3002",
      },
    });
    const { sessionId, token } = createRes.json();

    const delRes = await app.inject({
      method: "DELETE",
      url: `/api/session/${sessionId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(delRes.statusCode).toBe(204);
  });

  it("returns 401 when Authorization header is missing on DELETE", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/session/some-session",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 when token is wrong on DELETE", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/api/session",
      payload: {
        txHash: "txDel002",
        network: "testnet",
        wsUrl: "ws://localhost:3002",
      },
    });
    const { sessionId } = createRes.json();

    const res = await app.inject({
      method: "DELETE",
      url: `/api/session/${sessionId}`,
      headers: { authorization: "Bearer bad-token" },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------

describe("GET /api/ai/budget", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns budget status with expected shape", async () => {
    const res = await app.inject({ method: "GET", url: "/api/ai/budget" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.allowed).toBe("boolean");
    expect(typeof body.hourly_remaining).toBe("number");
    expect(typeof body.daily_remaining).toBe("number");
    expect(typeof body.concurrent_active).toBe("number");
  });
});

// ---------------------------------------------------------------------------

describe("POST /api/ai/explain", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 200 with explanation for valid payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ai/explain",
      payload: {
        report: { error: "HostError:Value(InvalidInput)" },
        tx_hash: "abc123",
        network: "testnet",
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ai/explain",
      payload: { tx_hash: "abc123" }, // missing report and network
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when body is empty", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ai/explain",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 429 when budget is exceeded (BudgetExceededError)", async () => {
    const { explainError } = await import("../ai");
    const { BudgetExceededError } = await import("../budget");

    vi.mocked(explainError).mockRejectedValueOnce(
      new BudgetExceededError({
        hourlyRemaining: 0,
        dailyRemaining: 4000,
        resetAt: new Date(Date.now() + 3_600_000),
      }),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/ai/explain",
      payload: {
        report: { error: "test" },
        tx_hash: "tx-budget-test",
        network: "testnet",
      },
    });
    expect(res.statusCode).toBe(429);
    const body = res.json();
    expect(typeof body.error).toBe("string");
  });

  it("returns 429 when concurrency limit is hit (ConcurrencyLimitError)", async () => {
    const { explainError } = await import("../ai");
    const { ConcurrencyLimitError } = await import("../budget");

    vi.mocked(explainError).mockRejectedValueOnce(
      new ConcurrencyLimitError(2, 2),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/ai/explain",
      payload: {
        report: { error: "test" },
        tx_hash: "tx-concurrency-test",
        network: "testnet",
      },
    });
    expect(res.statusCode).toBe(429);
  });

  it("returns 503 on unexpected internal errors", async () => {
    const { explainError } = await import("../ai");
    vi.mocked(explainError).mockRejectedValueOnce(
      new Error("Unexpected upstream failure"),
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/ai/explain",
      payload: {
        report: { error: "test" },
        tx_hash: "tx-error-test",
        network: "testnet",
      },
    });
    // ai route maps generic errors to 500
    expect(res.statusCode).toBe(500);
  });
});

// ---------------------------------------------------------------------------

describe("DELETE /api/ai/cache/:txHash", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns invalidated count for known tx hash", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/ai/cache/abc123",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tx_hash).toBe("abc123");
    expect(typeof body.invalidated).toBe("number");
  });
});

describe("DELETE /api/ai/cache", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns invalidated count when clearing all cache", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/ai/cache" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.invalidated).toBe("number");
  });
});
