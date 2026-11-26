import type { FastifyInstance } from "fastify";
import { replayRateLimiter } from "../middleware/rate-limiter";
import { replayQueue, replayDLQ } from "../workers/queue";

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

  /**
   * GET /replay/admin/failed
   * Returns failed jobs from the main queue (last 50).
   */
  app.get("/replay/admin/failed", async (_request, reply) => {
    const failed = await replayQueue.getFailed(0, 49);
    return {
      count: failed.length,
      jobs: failed.map((job) => ({
        jobId: job.id,
        txHash: job.data?.txHash,
        requestId: job.data?.requestId,
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason,
        timestamp: job.timestamp,
      })),
    };
  });

  /**
   * GET /replay/admin/dlq
   * Returns jobs in the dead-letter queue (last 50).
   */
  app.get("/replay/admin/dlq", async (_request, reply) => {
    const [waiting, completed] = await Promise.all([
      replayDLQ.getWaiting(0, 24),
      replayDLQ.getCompleted(0, 24),
    ]);
    const jobs = [...waiting, ...completed];
    return {
      count: jobs.length,
      jobs: jobs.map((job) => ({
        jobId: job.id,
        originalJobId: job.data?.originalJobId,
        txHash: job.data?.txHash,
        requestId: job.data?.requestId,
        attemptsMade: job.data?.attemptsMade,
        failedReason: job.data?.failedReason,
        failedAt: job.data?.failedAt,
        timestamp: job.timestamp,
      })),
    };
  });

  /**
   * DELETE /replay/admin/dlq/:jobId
   * Remove a specific job from the dead-letter queue.
   */
  app.delete("/replay/admin/dlq/:jobId", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = await replayDLQ.getJob(jobId);
    if (!job) {
      return reply.status(404).send({ error: `DLQ job '${jobId}' not found`, statusCode: 404 });
    }
    await job.remove();
    return { removed: true, jobId };
  });
}
