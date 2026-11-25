import type { FastifyInstance } from "fastify";
import { explainError, explainErrorStream } from "../ai";
import { getBudgetStatus, assertBudgetAvailableForKey, recordUsageForKey } from "../budget";
import { BudgetExceededError, ConcurrencyLimitError } from "../budget";
import { invalidateByTxHash, clearAll } from "../cache";
import { MAX_AI_INPUT_LENGTH, sanitizeUserInput } from "../ai/prompts";

// ---------------------------------------------------------------------------
// Request / response schemas (inline for now — could be moved to a schema file)
// ---------------------------------------------------------------------------

interface ExplainBody {
  report: Record<string, unknown>;
  tx_hash: string;
  network: string;
}

interface CacheDeleteParams {
  txHash: string;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export async function aiRoutes(app: FastifyInstance) {
  /**
   * POST /api/ai/explain
   *
   * Accepts a DiagnosticReport and returns an AI-generated explanation.
   * Integrates request deduplication, token-budget enforcement, and caching.
   */
  app.post<{ Body: ExplainBody }>("/ai/explain", async (request, reply) => {
    const { report, tx_hash, network } = request.body;

    if (!report || !tx_hash || !network) {
      return reply.status(400).send({
        error: "Missing required fields: report, tx_hash, network",
      });
    }

    // Extract API key from request headers
    const apiKey =
      (request.headers["x-api-key"] as string | undefined) ||
      (request.headers["authorization"] as string | undefined);

    try {
      const reportJson = JSON.stringify(report, (_key, value: unknown) =>
        typeof value === "string" ? sanitizeUserInput(value) : value,
      );
      const sanitizedInput = sanitizeUserInput(reportJson);
      request.log.info(
        { tx_hash, network, sanitized_input: sanitizedInput },
        "AI explain request received",
      );

      if (sanitizedInput.length > MAX_AI_INPUT_LENGTH) {
        return reply.status(413).send({
          error: `AI input exceeds the ${MAX_AI_INPUT_LENGTH}-character limit.`,
        });
      }

      // Enforce per-key budget if an API key is present
      if (apiKey) {
        await assertBudgetAvailableForKey(apiKey);
      }

      const explanation = await explainError(sanitizedInput, tx_hash, network);

      // Record per-key usage after a successful response
      if (apiKey) {
        await recordUsageForKey(apiKey, explanation.tokens_used);
      }

      request.log.info(
        { tx_hash, network, sanitized_input: sanitizedInput, response: explanation },
        "AI explain response generated",
      );
      return explanation;
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        reply.header("Retry-After", String(err.retryAfterSeconds));
        return reply.status(429).send({
          error: err.message,
          hourly_remaining: err.hourlyRemaining,
          daily_remaining: err.dailyRemaining,
          reset_at: err.resetAt.toISOString(),
        });
      }
      if (err instanceof ConcurrencyLimitError) {
        return reply.status(429).send({
          error: err.message,
          concurrent_active: err.currentActive,
          concurrent_limit: err.limit,
        });
      }
      request.log.error(err, "AI explain request failed");
      return reply.status(500).send({
        error: err instanceof Error ? err.message : "Internal server error",
      });
    }
  });

  /**
   * GET /api/ai/explain/stream
   *
   * Streams an AI-generated explanation as Server-Sent Events.
   * Query params: report (JSON string), tx_hash, network.
   *
   * Each chunk is sent as `data: <chunk>\n\n`.
   * The stream ends with `data: [DONE]\n\n`.
   * Budget or concurrency errors are sent as a structured `data:` error event.
   */
  app.get<{ Querystring: { report: string; tx_hash: string; network: string } }>(
    "/ai/explain/stream",
    async (request, reply) => {
      const { report, tx_hash, network } = request.query;

      if (!report || !tx_hash || !network) {
        return reply.status(400).send({
          error: "Missing required query params: report, tx_hash, network",
        });
      }

      const sanitizedInput = sanitizeUserInput(report);
      if (sanitizedInput.length > MAX_AI_INPUT_LENGTH) {
        return reply.status(413).send({
          error: `AI input exceeds the ${MAX_AI_INPUT_LENGTH}-character limit.`,
        });
      }

      // Wire up a cancellation signal tied to client disconnect
      const abortController = new AbortController();
      request.raw.on("close", () => abortController.abort());

      // Take over the socket — Fastify must not touch it after this point
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      try {
        const stream = explainErrorStream(
          sanitizedInput,
          tx_hash,
          network,
          abortController.signal,
        );

        for await (const chunk of stream) {
          if (abortController.signal.aborted) break;
          reply.raw.write(`data: ${chunk}\n\n`);
        }

        if (!abortController.signal.aborted) {
          reply.raw.write("data: [DONE]\n\n");
        }
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          const payload = JSON.stringify({
            error: err.message,
            code: "BUDGET_EXCEEDED",
            hourly_remaining: err.hourlyRemaining,
            daily_remaining: err.dailyRemaining,
            reset_at: err.resetAt.toISOString(),
          });
          reply.raw.write(`data: ${payload}\n\n`);
        } else if (err instanceof ConcurrencyLimitError) {
          const payload = JSON.stringify({
            error: err.message,
            code: "CONCURRENCY_LIMIT",
            concurrent_active: err.currentActive,
            concurrent_limit: err.limit,
          });
          reply.raw.write(`data: ${payload}\n\n`);
        } else {
          request.log.error(err, "AI explain/stream request failed");
          const payload = JSON.stringify({ error: "Internal server error" });
          reply.raw.write(`data: ${payload}\n\n`);
        }
      } finally {
        reply.raw.end();
      }
    },
  );

  /**
   * GET /api/ai/budget
   *
   * Returns current token usage and remaining budget.
   */
  app.get("/ai/budget", async () => {
    return getBudgetStatus();
  });

  /**
   * DELETE /api/ai/cache/:txHash
   *
   * Invalidates all cached AI responses for a specific transaction hash.
   */
  app.delete<{ Params: CacheDeleteParams }>(
    "/ai/cache/:txHash",
    async (request) => {
      const { txHash } = request.params;
      const removed = await invalidateByTxHash(txHash);
      return { invalidated: removed, tx_hash: txHash };
    },
  );

  /**
   * DELETE /api/ai/cache
   *
   * Clears the entire AI response cache.
   */
  app.delete("/ai/cache", async () => {
    const removed = await clearAll();
    return { invalidated: removed };
  });
}
