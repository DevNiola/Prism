import type { FastifyInstance } from "fastify";
import { replayRateLimiter } from "../middleware/rate-limiter";
import { errorEnvelope } from "../middleware/error-handler";
import { replayPostBodySchema } from "../validators/schemas";

export async function replayRoutes(app: FastifyInstance) {
  app.post("/replay", { preHandler: [replayRateLimiter] }, async (request, reply) => {
    const parsed = replayPostBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send(
        errorEnvelope(
          "VALIDATION_ERROR",
          "Invalid replay request payload",
          parsed.error.errors,
        ),
      );
    }

    // parsed.data contains the validated and defaulted fields
    const { txHash, network } = parsed.data;
    void txHash;
    void network;

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
