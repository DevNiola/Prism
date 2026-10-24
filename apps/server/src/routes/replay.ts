import type { FastifyInstance } from "fastify";
import { replayRateLimiter } from "../middleware/rate-limiter";

export async function replayRoutes(app: FastifyInstance) {
  app.post("/replay", { preHandler: [replayRateLimiter] }, async (request, reply) => {
    return { status: "queued" };
  });

  app.get("/replay/:jobId", async (request, reply) => {
    return { status: "pending" };
  });
}
