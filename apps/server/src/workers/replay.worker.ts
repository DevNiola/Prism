import { Worker } from "bullmq";
import { spawn } from "node:child_process";
import { config } from "../config";
import { explainError } from "../ai";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CancelReason = "cancelled" | "timeout";

export interface ReplayResult {
  report: unknown | null;
  explanation?: { tokens_used: number; cached: boolean } | null;
  cancelled?: boolean;
  cancelReason?: CancelReason;
}

// ---------------------------------------------------------------------------
// Active-job registry
//
// Maps BullMQ job IDs to the AbortController for the in-flight grat process.
// Routes and WebSocket handlers can call `cancelReplay(jobId)` to abort a
// running replay and have the worker emit a trace_error event.
// ---------------------------------------------------------------------------
const activeJobs = new Map<string, AbortController>();

/**
 * Cancel an in-flight replay job.  Safe to call even if the job has already
 * finished — the AbortController will simply be missing from the registry.
 */
export function cancelReplay(jobId: string): boolean {
  const controller = activeJobs.get(jobId);
  if (!controller) return false;
  controller.abort(new Error("cancelled"));
  return true;
}

// ---------------------------------------------------------------------------
// grat binary invocation
// ---------------------------------------------------------------------------

/**
 * Spawn the grat binary and return its stdout as a string.
 *
 * The process is killed when either:
 *   - `signal` is aborted (client cancel or server-side cancellation), or
 *   - `timeoutMs` elapses (server-side replay timeout).
 *
 * On abort the promise rejects with the abort reason.
 * On timeout the promise rejects with a timeout Error.
 */
function runGrat(
  args: string[],
  signal: AbortSignal,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Set up the hard timeout independent of the AbortSignal.
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error("timeout"));
    }, timeoutMs);

    const proc = spawn(config.gratBinaryPath, args, { signal });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    proc.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    proc.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));

    proc.on("close", (code, killSignal) => {
      clearTimeout(timer);

      if (signal.aborted) {
        reject(signal.reason instanceof Error ? signal.reason : new Error("cancelled"));
        return;
      }

      if (killSignal) {
        reject(new Error(`timeout`));
        return;
      }

      if (code !== 0) {
        reject(
          new Error(
            `grat exited with code ${code}: ${Buffer.concat(stderr).toString().trim()}`,
          ),
        );
        return;
      }

      resolve(Buffer.concat(stdout).toString());
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      // AbortError is thrown by Node when spawn itself is aborted.
      reject(err);
    });
  });
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

const worker = new Worker<{
  txHash: string;
  network?: string;
  report?: unknown;
}>(
  "replay",
  async (job) => {
    console.log(`Processing replay job ${job.id}: ${job.data.txHash}`);

    // Per-job AbortController — shared between the grat spawn and any
    // external cancellation request (via cancelReplay()).
    const controller = new AbortController();
    if (job.id) activeJobs.set(job.id, controller);

    let report: unknown | null = job.data.report ?? null;
    let cancelReason: CancelReason | undefined;

    try {
      // If no pre-computed report was provided, run the grat binary.
      if (!report) {
        const output = await runGrat(
          ["replay", job.data.txHash, "--network", job.data.network ?? "mainnet", "--json"],
          controller.signal,
          config.replay.timeoutMs,
        );
        try {
          report = JSON.parse(output);
        } catch {
          report = { raw: output };
        }
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : String(err);

      if (message === "cancelled" || controller.signal.aborted) {
        cancelReason = "cancelled";
      } else if (message === "timeout") {
        cancelReason = "timeout";
      }

      console.warn(
        `Replay job ${job.id} aborted — reason: ${cancelReason ?? message}`,
      );

      return {
        report: null,
        cancelled: true,
        cancelReason: cancelReason ?? "cancelled",
      } satisfies ReplayResult;
    } finally {
      if (job.id) activeJobs.delete(job.id);
    }

    // Optionally generate an AI explanation.
    if (report && config.ai.apiKey) {
      try {
        const explanation = await explainError(
          JSON.stringify(report),
          job.data.txHash,
          job.data.network ?? "mainnet",
        );
        console.log(
          `AI explanation generated for job ${job.id} ` +
            `(${explanation.tokens_used} tokens, cached=${explanation.cached})`,
        );
        return { report, explanation } satisfies ReplayResult;
      } catch (err) {
        // AI failure is non-fatal — the replay result is still valid.
        console.warn(`AI explanation failed for job ${job.id}:`, err);
        return { report, explanation: null } satisfies ReplayResult;
      }
    }

    return { report } satisfies ReplayResult;
  },
  { connection: { url: config.redisUrl } },
);

export default worker;
