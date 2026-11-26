import { Worker } from "bullmq";
import { config } from "../config";
import { explainError } from "../ai";
import { logger } from "../logger";
import { replayQueue, replayDLQ, REPLAY_LOCK_DURATION_MS } from "./queue";

let completedCount = 0;

export const worker = new Worker(
  "replay",
  async (job) => {
    const requestId = job.data.requestId;
    logger.info(`Processing replay job ${job.id}: ${job.data.txHash}`, {
      job_id: job.id,
      tx_hash: job.data.txHash,
      request_id: requestId,
      attempt: job.attemptsMade + 1,
    });

    let result = { report: job.data.report ?? null, explanation: null as any };

    // After replay produces a diagnostic report, optionally generate an
    // AI explanation.  `job.data.report` is populated by the replay engine
    // once the trace is complete.
    if (job.data.report && config.ai.apiKey) {
      try {
        const explanation = await explainError(
          JSON.stringify(job.data.report),
          job.data.txHash,
          job.data.network || "mainnet",
        );
        logger.info(
          `AI explanation generated for job ${job.id} (${explanation.tokens_used} tokens, cached=${explanation.cached})`,
          {
            job_id: job.id,
            request_id: requestId,
            tokens_used: explanation.tokens_used,
            cached: explanation.cached,
          },
        );
        result.explanation = explanation;
      } catch (err) {
        // AI failure is non-fatal — the replay result is still valid
        logger.warn(`AI explanation failed for job ${job.id}`, {
          job_id: job.id,
          request_id: requestId,
          error: String(err),
        });
        return { report: job.data.report, explanation: null };
      }
    }

    completedCount++;
    return result;
  },
  {
    connection: { url: config.redisUrl },
    /**
     * lockDuration defines the visibility timeout: if the worker crashes or
     * stalls, BullMQ reclaims the job after this many milliseconds and retries
     * it (up to the job's configured attempt limit).
     */
    lockDuration: REPLAY_LOCK_DURATION_MS,
    /**
     * Concurrency limit — process up to 5 replay jobs simultaneously.
     */
    concurrency: 5,
  },
);

/**
 * Move exhausted jobs to the dead-letter queue so they are visible to admins
 * without polluting the main failed set indefinitely.
 */
worker.on("failed", async (job, err) => {
  if (!job) return;
  const attemptsLeft = (job.opts.attempts ?? 1) - job.attemptsMade;
  if (attemptsLeft > 0) {
    // Still has retries remaining — just log the transient failure.
    logger.warn(`Replay job ${job.id} failed (attempt ${job.attemptsMade}), will retry`, {
      job_id: job.id,
      tx_hash: job.data?.txHash,
      attempt: job.attemptsMade,
      error: err.message,
    });
    return;
  }

  logger.error(`Replay job ${job.id} exhausted all retries — moving to DLQ`, {
    job_id: job.id,
    tx_hash: job.data?.txHash,
    attempts_made: job.attemptsMade,
    error: err.message,
  });

  try {
    await replayDLQ.add(
      "dead-letter",
      {
        originalJobId: job.id,
        txHash: job.data?.txHash,
        requestId: job.data?.requestId,
        network: job.data?.network,
        failedReason: err.message,
        attemptsMade: job.attemptsMade,
        failedAt: new Date().toISOString(),
      },
      { jobId: `dlq-${job.id}` },
    );
  } catch (dlqErr) {
    logger.error(`Failed to move job ${job.id} to DLQ`, {
      job_id: job.id,
      error: String(dlqErr),
    });
  }
});

/**
 * Gracefully shuts down the worker:
 * - Stops accepting new jobs by pausing the queue.
 * - Drains in-flight jobs.
 * - Logs shutdown summary (jobs completed, jobs remaining).
 * - Enforces configurable timeout (default 30s).
 */
export async function shutdownWorker(
  timeoutMs: number = config.gracefulShutdownTimeoutMs || 30_000,
): Promise<{ completed: number; remaining: number }> {
  console.log("Stopping worker queue and finishing in-flight jobs...");

  try {
    await replayQueue.pause();
  } catch (err) {
    console.warn("Failed to pause replay queue:", err);
  }

  const closePromise = worker.close();
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`Worker shutdown timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  try {
    await Promise.race([closePromise, timeoutPromise]);
  } catch (err) {
    console.error("Worker close timed out or failed:", err);
  }

  let remaining = 0;
  try {
    remaining = (await replayQueue.getWaitingCount()) + (await replayQueue.getActiveCount());
  } catch {}

  console.log(
    `Shutdown summary: ${completedCount} jobs completed during lifetime, ${remaining} jobs remaining in queue`,
  );

  return { completed: completedCount, remaining };
}

export default worker;
