import { Worker } from "bullmq";
import { config } from "../config";
import { explainError } from "../ai";
import { logger } from "../logger";

const worker = new Worker(
  "replay",
  async (job) => {
    const requestId = job.data.requestId;
    logger.info(`Processing replay job ${job.id}: ${job.data.txHash}`, {
      job_id: job.id,
      tx_hash: job.data.txHash,
      request_id: requestId,
    });

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
        return { report: job.data.report, explanation };
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

    return { report: job.data.report ?? null };
  },
  { connection: { url: config.redisUrl } },
);

export default worker;
