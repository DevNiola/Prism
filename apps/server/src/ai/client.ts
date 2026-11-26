import { randomUUID } from "node:crypto";
import { config } from "../config";
import {
  fingerprint,
  tryAcquire,
  publishResult,
  waitForResult,
} from "../dedup";
import {
  assertBudgetAvailable,
  recordUsage,
  acquireConcurrency,
  releaseConcurrency,
} from "../budget";
import { getCache, setCache } from "../cache";
import {
  MAX_AI_INPUT_LENGTH,
  SYSTEM_PROMPT,
  buildUserPrompt,
  estimateTokens,
  sanitizeUserInput,
} from "./prompts";
import type { AIExplanation } from "./types";

// ---------------------------------------------------------------------------
// Provider-agnostic AI API call
// ---------------------------------------------------------------------------

interface ChatCompletion {
  summary: string;
  detailed_explanation: string;
  suggested_fixes: string[];
  tokens_used: number;
}

/**
 * Calls an OpenAI-compatible chat-completions endpoint.
 * Abstracted so the provider can be swapped by changing `config.ai.apiBaseUrl`.
 */
async function callLLM(reportJson: string): Promise<ChatCompletion> {
  const {
    apiKey,
    apiBaseUrl,
    model,
    maxTokensPerRequest,
    temperature,
    timeoutMs,
  } = config.ai;

  if (!apiKey) {
    throw new Error(
      "AI_API_KEY is not configured. Set the AI_API_KEY environment variable.",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${apiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokensPerRequest,
        temperature,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(reportJson) },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`AI provider returned HTTP ${response.status}: ${text}`);
    }

    const data = (await response.json()) as {
      choices: { message: { content: string } }[];
      usage?: { total_tokens: number };
    };

    const raw = data.choices?.[0]?.message?.content;
    if (!raw) {
      throw new Error("AI provider returned an empty response.");
    }

    const parsed = JSON.parse(raw) as {
      summary?: string;
      detailed_explanation?: string;
      suggested_fixes?: string[];
    };

    return {
      summary: parsed.summary ?? "Unable to summarize.",
      detailed_explanation:
        parsed.detailed_explanation ?? "No detailed explanation provided.",
      suggested_fixes: parsed.suggested_fixes ?? [],
      tokens_used: data.usage?.total_tokens ?? estimateTokens(raw),
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Streaming pipeline: budget → concurrency → LLM (stream: true) → yield chunks
// ---------------------------------------------------------------------------

/**
 * Streaming variant of the AI explain pipeline.
 *
 * Calls the LLM with `stream: true` and yields plain-text content chunks as
 * they arrive from the upstream SSE feed. No caching or deduplication is
 * applied to streaming responses.
 *
 * Token budget is enforced before the request starts and usage is recorded
 * (via `estimateTokens`) when the stream ends.
 *
 * @param reportJson  Sanitized diagnostic-report JSON string.
 * @param txHash      Transaction hash (used only for observability; not cached).
 * @param network     Network identifier.
 * @param signal      Optional AbortSignal so the caller can cancel mid-stream.
 */
export async function* explainErrorStream(
  reportJson: string,
  txHash: string,
  network: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  // 1. Budget pre-flight
  await assertBudgetAvailable();

  // 2. Concurrency gate
  await acquireConcurrency();

  const { apiKey, apiBaseUrl, model, maxTokensPerRequest, temperature, timeoutMs } =
    config.ai;

  if (!apiKey) {
    await releaseConcurrency();
    throw new Error(
      "AI_API_KEY is not configured. Set the AI_API_KEY environment variable.",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  let accumulatedContent = "";

  try {
    const response = await fetch(`${apiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokensPerRequest,
        temperature,
        stream: true,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(reportJson) },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`AI provider returned HTTP ${response.status}: ${text}`);
    }

    if (!response.body) {
      throw new Error("AI provider returned a response with no body.");
    }

    // Parse the SSE stream line by line
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;

        const dataStr = trimmed.slice(5).trim();
        if (dataStr === "[DONE]") return;

        try {
          const parsed = JSON.parse(dataStr) as {
            choices?: { delta?: { content?: string } }[];
          };
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            accumulatedContent += content;
            yield content;
          }
        } catch {
          // Malformed SSE data line — skip silently
        }
      }
    }
  } finally {
    clearTimeout(timer);
    const tokensUsed = estimateTokens(accumulatedContent);
    if (tokensUsed > 0) {
      await recordUsage(tokensUsed).catch(() => {});
    }
    await releaseConcurrency();
  }
}

// ---------------------------------------------------------------------------
// Orchestrated pipeline: dedup → budget → cache → LLM → cache → publish
// ---------------------------------------------------------------------------

/**
 * High-level entry point. Given a raw diagnostic report (as JSON string),
 * return a plain-English AI explanation.
 *
 * The function coordinates deduplication, budget enforcement, cache lookup,
 * the LLM call, cache write, and usage recording.
 */
export async function explainError(
  reportJson: string,
  txHash: string,
  network: string,
): Promise<AIExplanation> {
  const sanitizedReportJson = sanitizeUserInput(reportJson);
  if (sanitizedReportJson.length > MAX_AI_INPUT_LENGTH) {
    throw new Error(`AI input exceeds the ${MAX_AI_INPUT_LENGTH}-character limit.`);
  }

  const fp = fingerprint(txHash, network, "explain");

  // 1. Cache hit — return immediately
  const cached = await getCache("explain", fp);
  if (cached) {
    const parsed = JSON.parse(cached) as AIExplanation;
    return { ...parsed, cached: true };
  }

  // 2. Dedup — is there already an in-flight request for this fingerprint?
  const dedup = await tryAcquire(fp);

  if (!dedup.acquired) {
    // Another request is already processing — wait for its result
    const coalesced = await waitForResult(fp);
    if (coalesced) {
      const parsed = JSON.parse(coalesced) as AIExplanation;
      return { ...parsed, cached: true, request_id: dedup.requestId };
    }
    // Fallback: the original timed out — treat this as a fresh request
  }

  // 3. Budget pre-flight
  await assertBudgetAvailable();

  // 4. Concurrency gate
  await acquireConcurrency();

  try {
    // 5. Call the LLM
    const result = await callLLM(sanitizedReportJson);

    const explanation: AIExplanation = {
      summary: result.summary,
      detailed_explanation: result.detailed_explanation,
      suggested_fixes: result.suggested_fixes,
      tokens_used: result.tokens_used,
      cached: false,
      request_id: dedup.requestId,
    };

    // 6. Record token usage
    await recordUsage(result.tokens_used);

    // 7. Cache the result
    const serialized = JSON.stringify(explanation);
    await setCache("explain", fp, serialized);

    // 8. Publish result for any coalesced waiters
    await publishResult(fp, serialized);

    return explanation;
  } finally {
    await releaseConcurrency();
  }
}
