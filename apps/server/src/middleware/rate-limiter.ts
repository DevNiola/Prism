import type { FastifyRequest, FastifyReply } from "fastify";
import { config } from "../config";
import { incrBy, setExpiry } from "../redis";

/**
 * Creates a rate limiting preHandler middleware backed by Redis / in-memory store.
 * Uses a fixed/sliding token window per IP address.
 */
export function createRateLimiter(options?: {
  limit?: number;
  windowSec?: number;
  name?: string;
}) {
  const limit = options?.limit ?? config.rateLimit.defaultLimit;
  const windowSec = options?.windowSec ?? config.rateLimit.windowSec;
  const name = options?.name ?? "api";

  return async function rateLimitMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const ip = request.ip || request.socket.remoteAddress || "127.0.0.1";
    const key = `ratelimit:${name}:${ip}`;

    try {
      const current = await incrBy(key, 1);
      if (current === 1) {
        // Set expiry on initial request
        await setExpiry(key, windowSec);
      }

      reply.header("X-RateLimit-Limit", limit);
      reply.header("X-RateLimit-Remaining", Math.max(0, limit - current));

      if (current > limit) {
        reply.header("Retry-After", windowSec);
        return reply.status(429).send({
          statusCode: 429,
          error: "Too Many Requests",
          message: `Rate limit of ${limit} requests per ${windowSec}s exceeded for this IP. Please try again later.`,
        });
      }
    } catch (err) {
      // Non-fatal if rate limiter encounters an error
      request.log.warn({ error: String(err) }, "Rate limiter error, allowing request");
    }
  };
}

export const defaultRateLimiter = createRateLimiter({
  limit: config.rateLimit.defaultLimit,
  name: "default",
});

export const replayRateLimiter = createRateLimiter({
  limit: config.rateLimit.replayLimit,
  name: "replay",
});
