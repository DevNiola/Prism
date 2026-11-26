import { Queue } from "bullmq";
import { config } from "../config";

/**
 * Maximum replay duration before BullMQ considers a job stalled (visibility
 * timeout). Set conservatively at 5 minutes to allow long replays while still
 * recovering from wedged workers.
 */
const REPLAY_LOCK_DURATION_MS = 5 * 60 * 1_000; // 5 minutes

export const replayQueue = new Queue("replay", {
  connection: { url: config.redisUrl },
  defaultJobOptions: {
    /**
     * Exponential backoff retry policy:
     *   attempt 1 → immediate
     *   attempt 2 → 2 s
     *   attempt 3 → 4 s
     * After 3 attempts the job moves to the dead-letter queue (failed set).
     */
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2_000,
    },
    /**
     * Keep the last 100 completed and 500 failed jobs for inspection via the
     * admin routes. Failed jobs act as the dead-letter queue.
     */
    removeOnComplete: { count: 100 },
    removeOnFail: false,
  },
});

/**
 * Dead-letter queue — receives jobs that have exhausted all retries.
 * Jobs are added here explicitly by the worker's failed event handler.
 */
export const replayDLQ = new Queue("replay-dlq", {
  connection: { url: config.redisUrl },
  defaultJobOptions: {
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 500 },
  },
});

export { REPLAY_LOCK_DURATION_MS };
