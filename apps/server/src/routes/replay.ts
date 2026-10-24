import type { FastifyInstance } from "fastify";
import { validateReplayInput } from "../validators";
import { replayQueue } from "../workers/queue";

export async function replayRoutes(app: FastifyInstance) {
  app.post("/replay", async (request, reply) => {
    const validation = validateReplayInput(request.body);
    if (!validation.valid || !validation.sanitized) {
      request.log.warn({ error: validation.error }, "Replay input validation failed");
      return reply.status(400).send({
        error: validation.error,
        statusCode: 400,
      });
    }

    const { txHash, network } = validation.sanitized;
    const reqId = request.id;

    request.log.info({ txHash, network, request_id: reqId }, "Enqueueing replay job");

    const job = await replayQueue.add(
      "replay",
      {
        txHash,
        network,
        requestId: reqId,
      },
      {
        jobId: `replay:${network}:${txHash}`,
        removeOnComplete: true,
      },
    );

    return reply.status(202).send({
      status: "queued",
      jobId: job.id,
      txHash,
      network,
      request_id: reqId,
    });
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
