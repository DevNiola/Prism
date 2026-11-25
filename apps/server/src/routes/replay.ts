import type { FastifyInstance } from "fastify";
import { replayQueue } from "../workers/queue";
import { cancelReplay } from "../workers/replay.worker";
import { config } from "../config";

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

const replayBodySchema = {
  body: {
    type: "object",
    required: ["txHash"],
    properties: {
      txHash: { type: "string", minLength: 1 },
      network: { type: "string" },
    },
  },
} as const;

const jobIdParamSchema = {
  params: {
    type: "object",
    required: ["jobId"],
    properties: {
      jobId: { type: "string", minLength: 1 },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function replayRoutes(app: FastifyInstance) {
  /**
   * POST /api/replay
   *
   * Enqueues a new replay job.  Returns the job ID the client should poll or
   * subscribe to via WebSocket.  The job is subject to `config.replay.timeoutMs`
   * on the worker side.
   */
  app.post<{ Body: { txHash: string; network?: string } }>(
    "/replay",
    { schema: replayBodySchema },
    async (request, reply) => {
      const { txHash, network = "mainnet" } = request.body;

      const job = await replayQueue.add(
        "replay",
        { txHash, network },
        {
          // Mirror the server-side timeout so BullMQ can also expire the job
          // if the worker process is killed before it can mark it done.
          jobId: undefined,
          removeOnComplete: { age: 3_600 },
          removeOnFail: { age: 3_600 },
          timeout: config.replay.timeoutMs,
        },
      );

      return reply.status(202).send({
        status: "queued",
        jobId: job.id,
        timeoutMs: config.replay.timeoutMs,
      });
    },
  );

  /**
   * GET /api/replay/:jobId
   *
   * Returns the current state of a replay job.
   */
  app.get<{ Params: { jobId: string } }>(
    "/replay/:jobId",
    { schema: jobIdParamSchema },
    async (request, reply) => {
      const { jobId } = request.params;

      const job = await replayQueue.getJob(jobId);
      if (!job) {
        return reply
          .status(404)
          .send({ status: "not_found", jobId });
      }

      const state = await job.getState();
      const result = job.returnvalue as
        | { report: unknown; cancelled?: boolean; cancelReason?: string }
        | undefined;

      return reply.send({
        jobId,
        status: state,
        ...(result?.cancelled
          ? { cancelled: true, cancelReason: result.cancelReason }
          : {}),
        ...(result?.report !== undefined && result.report !== null
          ? { report: result.report }
          : {}),
      });
    },
  );

  /**
   * POST /api/replay/:jobId/cancel
   *
   * Signals the worker to abort the in-flight grat process.  If the job is
   * still active the worker will kill the subprocess, store a cancelled result,
   * and emit a `trace_error` event with `reason: "cancelled"` over WebSocket.
   *
   * Returns 200 if the signal was delivered, 404 if no such job is active.
   */
  app.post<{ Params: { jobId: string } }>(
    "/replay/:jobId/cancel",
    { schema: jobIdParamSchema },
    async (request, reply) => {
      const { jobId } = request.params;

      // Try to abort an in-flight worker first.
      const signalled = cancelReplay(jobId);

      if (!signalled) {
        // The job may already be complete or never existed.
        const job = await replayQueue.getJob(jobId);
        if (!job) {
          return reply.status(404).send({ status: "not_found", jobId });
        }

        // If the job is waiting in the queue it hasn't started yet — remove it.
        const state = await job.getState();
        if (state === "waiting" || state === "delayed") {
          await job.remove();
          return reply.send({ status: "cancelled", jobId });
        }

        // Already completed or failed — nothing to cancel.
        return reply.send({ status: "already_finished", jobId, state });
      }

      return reply.send({ status: "cancelling", jobId });
    },
  );
}
