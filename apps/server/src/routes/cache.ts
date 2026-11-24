import type { FastifyInstance } from "fastify";
import { invalidateByKey, getHitMissRatio } from "../cache/manager";

export async function cacheRoutes(app: FastifyInstance) {
  app.delete("/cache/:key", async (request, reply) => {
    const { key } = request.params as { key: string };
    if (!key) {
      return reply.status(400).send({ error: "Cache key is required" });
    }

    const invalidated = await invalidateByKey(key);
    request.log.info({ key, invalidated, request_id: request.id }, "Manual cache invalidation requested");

    return {
      status: invalidated ? "invalidated" : "not_found",
      key,
      success: invalidated,
    };
  });

  app.get("/cache/stats", async () => {
    return getHitMissRatio();
  });
}
