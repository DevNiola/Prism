import type { FastifyInstance } from "fastify";
import { replayRateLimiter } from "../middleware/rate-limiter";

export async function replayRoutes(app: FastifyInstance) {
  app.post("/replay", { preHandler: [replayRateLimiter] }, async (request, reply) => {
    return { status: "queued" };
  });

  app.get("/replay/:jobId", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = await replayQueue.getJob(jobId);

    if (!job) {
      return reply.status(404).send({
        error: `Replay job '${jobId}' not found`,
        statusCode: 404,
      });
    }

    const state = await job.getState();
    const progress = job.progress;

    return {
      jobId: job.id,
      state,
      progress,
      result: job.returnvalue || null,
      failedReason: job.failedReason || null,
    };
  });
}
