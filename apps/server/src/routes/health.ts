import type { FastifyInstance } from "fastify";
import { config } from "../config";
import { getRedis } from "../redis";
import { replayQueue } from "../workers/queue";
import { defaultRateLimiter } from "../middleware/rate-limiter";

type DependencyStatus<T extends object = object> =
  | ({ status: "up"; latency_ms: number } & T)
  | { status: "down"; latency_ms: number; error: string };

async function checkDependency<T extends object>(
  check: () => Promise<T>,
): Promise<DependencyStatus<T>> {
  const startedAt = Date.now();
  try {
    return {
      status: "up",
      latency_ms: Date.now() - startedAt,
      ...(await check()),
    };
  } catch (error) {
    return {
      status: "down",
      latency_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Dependency check failed",
    };
  }
}

export async function healthRoutes(app: FastifyInstance) {
  /**
   * Liveness probe — answers as long as the Node process is running.
   * Used by: docker-compose HEALTHCHECK, k8s livenessProbe.
   */
  app.get("/health/live", async (_request, reply) => {
    return reply.status(200).send({ status: "ok" });
  });

  /**
   * Readiness probe — answers only when all dependencies are healthy.
   * Used by: docker-compose depends_on condition, k8s readinessProbe.
   */
  app.get(
    "/health/ready",
    { preHandler: [defaultRateLimiter] },
    async (_request, reply) => {
      const [redis, sorobanRpc, workerQueue] = await Promise.all([
        checkDependency(async () => {
          await getRedis().ping();
          return {};
        }),
        checkDependency(async () => {
          const response = await fetch(config.sorobanRpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "getHealth",
            }),
            signal: AbortSignal.timeout(5_000),
          });
          if (!response.ok) {
            throw new Error(`RPC returned HTTP ${response.status}`);
          }
          const result = (await response.json()) as { error?: { message?: string } };
          if (result.error) {
            throw new Error(result.error.message || "RPC health request failed");
          }
          return {};
        }),
        checkDependency(async () => ({
          depth: await replayQueue.getWaitingCount(),
        })),
      ]);

      const dependencies = { redis, soroban_rpc: sorobanRpc, worker_queue: workerQueue };
      const healthy = Object.values(dependencies).every(
        (dependency) => dependency.status === "up",
      );

      return reply.status(healthy ? 200 : 503).send({
        status: healthy ? "ok" : "degraded",
        version: "0.1.0",
        dependencies,
      });
    },
  );

  /**
   * Legacy combined health endpoint — kept for backward compatibility.
   * Internally delegates to the readiness check.
   */
  app.get("/health", { preHandler: [defaultRateLimiter] }, async (request, reply) => {
    return reply.redirect("/health/ready");
  });
}
