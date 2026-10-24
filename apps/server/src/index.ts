import Fastify from "fastify";
import { replayRoutes } from "./routes/replay";
import { healthRoutes } from "./routes/health";
import { sessionRoutes } from "./routes/session";
import { aiRoutes } from "./routes/ai";
import { config, assertValidConfig } from "./config";
import { SessionStore } from "./session-store";

// Validate configuration on startup
assertValidConfig(config);

const server = Fastify({ logger: true });

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
server.addHook("onRequest", async (request, reply) => {
  const origin = request.headers.origin;
  if (!origin) {
    return;
  }

  const isAllowed =
    config.allowedOrigins.includes("*") || config.allowedOrigins.includes(origin);

  if (!isAllowed) {
    reply.status(403).send({ error: "Forbidden: Origin not allowed by CORS policy" });
    return;
  }

  reply.header("Access-Control-Allow-Origin", origin);
  reply.header(
    "Access-Control-Allow-Methods",
    "GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS",
  );
  reply.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Request-ID, X-Session-Token",
  );
  reply.header("Access-Control-Allow-Credentials", "true");

  if (request.method === "OPTIONS") {
    reply.status(204).send();
  }
});

// ---------------------------------------------------------------------------
// Routes: v1 Versioned Routes (Primary)
// ---------------------------------------------------------------------------
server.register(healthRoutes, { prefix: "/v1" });
server.register(replayRoutes, { prefix: "/v1/api" });
server.register(sessionRoutes, { prefix: "/v1/api" });
server.register(aiRoutes, { prefix: "/v1/api" });

// ---------------------------------------------------------------------------
// Routes: Legacy Root Routes with Deprecation Notice
// ---------------------------------------------------------------------------
server.register(async (legacy) => {
  legacy.addHook("onSend", async (_request, reply) => {
    reply.header("Deprecation", "true");
    reply.header("Sunset", "Wed, 01 Jan 2028 00:00:00 GMT");
    reply.header("Link", '</v1>; rel="successor-version"');
  });

  legacy.register(healthRoutes);
  legacy.register(replayRoutes, { prefix: "/api" });
  legacy.register(sessionRoutes, { prefix: "/api" });
  legacy.register(aiRoutes, { prefix: "/api" });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
server.listen({ port: config.port, host: "0.0.0.0" }, (err) => {
  if (err) {
    server.log.error(err);
    process.exit(1);
  }
});
