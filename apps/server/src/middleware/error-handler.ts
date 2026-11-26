import type { FastifyInstance, FastifyError } from "fastify";

// ---------------------------------------------------------------------------
// Error envelope helper
// ---------------------------------------------------------------------------

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Returns a normalized error response object in the shape:
 *   { error: { code, message, details? } }
 */
export function errorEnvelope(
  code: string,
  message: string,
  details?: unknown,
): ErrorEnvelope {
  const envelope: ErrorEnvelope = { error: { code, message } };
  if (details !== undefined) {
    envelope.error.details = details;
  }
  return envelope;
}

// ---------------------------------------------------------------------------
// Fastify error handler plugin
// ---------------------------------------------------------------------------

/**
 * Registers a global Fastify error handler that maps every thrown/sent error
 * to the normalized { error: { code, message, details? } } envelope.
 *
 * Mapping rules:
 *   - Validation errors (err.validation)  → 400 VALIDATION_ERROR
 *   - err.statusCode 401                  → 401 UNAUTHORIZED
 *   - err.statusCode 403                  → 403 FORBIDDEN
 *   - err.statusCode 429                  → 429 RATE_LIMITED
 *   - Anything else                       → 500 INTERNAL_ERROR (stack not leaked)
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, request, reply) => {
    // Fastify schema-validation errors carry an `err.validation` array.
    if (err.validation) {
      request.log.warn(
        { err, validation: err.validation, request_id: request.id },
        "Request validation failed",
      );
      return reply
        .status(400)
        .send(errorEnvelope("VALIDATION_ERROR", err.message, err.validation));
    }

    const status = err.statusCode ?? 500;

    if (status === 401) {
      request.log.warn({ err, request_id: request.id }, "Unauthorized");
      return reply
        .status(401)
        .send(errorEnvelope("UNAUTHORIZED", err.message));
    }

    if (status === 403) {
      request.log.warn({ err, request_id: request.id }, "Forbidden");
      return reply.status(403).send(errorEnvelope("FORBIDDEN", err.message));
    }

    if (status === 429) {
      request.log.warn({ err, request_id: request.id }, "Rate limited");
      return reply
        .status(429)
        .send(errorEnvelope("RATE_LIMITED", err.message));
    }

    // Default: treat as internal error; never leak the stack trace.
    request.log.error({ err, request_id: request.id }, "Unhandled server error");
    return reply
      .status(500)
      .send(errorEnvelope("INTERNAL_ERROR", "Internal server error"));
  });
}
