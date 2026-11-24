import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { replayRoutes } from "./routes/replay";
import { healthRoutes } from "./routes/health";
import { sessionRoutes } from "./routes/session";
import { aiRoutes } from "./routes/ai";
import { cacheRoutes } from "./routes/cache";
import { config, assertValidConfig } from "./config";
import { SessionStore } from "./session-store";
import { shutdownWorker } from "./workers/replay.worker";

// Validate configuration on startup
assertValidConfig(config);

const server = Fastify({
  genReqId(req) {
    const headerId = req.headers["x-request-id"];
    if (typeof headerId === "string" && headerId.trim()) {
      return headerId.trim();
    }
    return randomUUID();
  },
  requestIdHeader: "x-request-id",
  requestIdLogLabel: "request_id",
  logger: {
    level: config.logLevel || "info",
    serializers: {
      req(req) {
        return {
          request_id: req.id,
          method: req.method,
          url: req.url,
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  },
});

// ---------------------------------------------------------------------------
// Distributed Tracing: Return X-Request-ID header on all responses
// ---------------------------------------------------------------------------
server.addHook("onSend", async (request, reply) => {
  reply.header("X-Request-ID", request.id);
});

// ---------------------------------------------------------------------------
// Request Logging Middleware: log incoming requests with request_id
// ---------------------------------------------------------------------------
server.addHook("onRequest", async (request) => {
  request.log.info({
    request_id: request.id,
    method: request.method,
    url: request.url,
  }, "Incoming request");
});

// ---------------------------------------------------------------------------
// Bootstrap the session store and attach it as a decorator so every route
// plugin can access the same Redis-backed store instance.
// ---------------------------------------------------------------------------
const sessionStore = new SessionStore(config.redisUrl);

server.decorate("sessionStore", sessionStore);

// Ensure the Redis connection is live before accepting traffic, and close it
// cleanly when the process shuts down.
server.addHook("onReady", async () => {
  await sessionStore.connect();
  server.log.info("Session store connected to Redis");
});

server.addHook("onClose", async () => {
  await sessionStore.disconnect();
  server.log.info("Session store disconnected from Redis");
});

// ---------------------------------------------------------------------------
// CORS Middleware
// ---------------------------------------------------------------------------
server.register(healthRoutes);
server.register(replayRoutes, { prefix: "/api" });
server.register(sessionRoutes, { prefix: "/api" });
server.register(aiRoutes, { prefix: "/api" });
server.register(cacheRoutes, { prefix: "/api" });
server.register(cacheRoutes);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
server.listen({ port: config.port, host: "0.0.0.0" }, (err) => {
  if (err) {
    server.log.error(err);
    process.exit(1);
  }
});

// ---------------------------------------------------------------------------
// Graceful Shutdown on SIGINT / SIGTERM
// ---------------------------------------------------------------------------
let isShuttingDown = false;

async function handleGracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  server.log.info(`Received ${signal}, initiating graceful shutdown...`);

  const timeoutMs = config.gracefulShutdownTimeoutMs || 30_000;
  const forceTimer = setTimeout(() => {
    server.log.error(`Graceful shutdown timed out after ${timeoutMs}ms, force exiting`);
    process.exit(1);
  }, timeoutMs);

  try {
    // 1. Drain and close replay worker queue
    await shutdownWorker(timeoutMs);

    // 2. Stop accepting new HTTP requests and close Fastify
    await server.close();

    clearTimeout(forceTimer);
    server.log.info("Server shut down cleanly");
    process.exit(0);
  } catch (err) {
    server.log.error(err, "Error during graceful shutdown");
    clearTimeout(forceTimer);
    process.exit(1);
  }
}

process.on("SIGTERM", () => handleGracefulShutdown("SIGTERM"));
process.on("SIGINT", () => handleGracefulShutdown("SIGINT"));
