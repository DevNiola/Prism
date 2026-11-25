/**
 * JWT authentication middleware for protected API routes.
 *
 * Uses HS256 (HMAC-SHA256) implemented with Node's built-in `crypto` module
 * so no additional npm dependency is required.
 *
 * ## Token lifecycle
 *
 * 1. `signJwt(payload)` — issued at login / session creation.
 * 2. `verifyJwt(token)` — validates signature and expiry on every request.
 * 3. Sliding refresh — when fewer than `jwtRefreshThresholdSeconds` remain,
 *    `verifyJwt` returns a `refreshedToken` alongside the payload.  The route
 *    should forward that token back to the client via the
 *    `X-Refreshed-Token` response header.
 *
 * ## Production guard
 *
 * Call `assertAuthConfig()` once during server startup.  It aborts the process
 * if `NODE_ENV=production` and `disableSessionAuth` is true or if the JWT
 * secret is the insecure default value.
 */

import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import { config } from "../config";

// ---------------------------------------------------------------------------
// JWT primitives (HS256, no external dependency)
// ---------------------------------------------------------------------------

/** Standard JWT header for HS256. */
const HEADER_B64 = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));

export interface JwtPayload {
  /** Subject — typically the sessionId or userId. */
  sub: string;
  /** Issued-at (Unix epoch seconds). */
  iat: number;
  /** Expiry (Unix epoch seconds). */
  exp: number;
  /** Unique token ID — allows future revocation. */
  jti: string;
  /** Any additional claims. */
  [key: string]: unknown;
}

function base64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64urlDecode(input: string): Buffer {
  const padded = input + "=".repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function hmacSign(data: string, secret: string): string {
  return base64url(createHmac("sha256", secret).update(data).digest());
}

/**
 * Sign a JWT and return the compact token string.
 */
export function signJwt(
  sub: string,
  extraClaims: Record<string, unknown> = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub,
    iat: now,
    exp: now + config.auth.jwtExpirySeconds,
    jti: randomUUID(),
    ...extraClaims,
  };

  const headerAndPayload = `${HEADER_B64}.${base64url(JSON.stringify(payload))}`;
  const signature = hmacSign(headerAndPayload, config.auth.jwtSecret);
  return `${headerAndPayload}.${signature}`;
}

export type VerifyResult =
  | { valid: true; payload: JwtPayload; refreshedToken?: string }
  | { valid: false; reason: "expired" | "invalid" | "malformed" };

/**
 * Verify a JWT token.
 *
 * Returns the parsed payload on success.  When the token is within the
 * refresh window, also returns a freshly signed `refreshedToken` the caller
 * should forward to the client.
 */
export function verifyJwt(token: string): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { valid: false, reason: "malformed" };

  const [headerB64, payloadB64, sigB64] = parts;

  // Constant-time signature check.
  const expectedSig = hmacSign(`${headerB64}.${payloadB64}`, config.auth.jwtSecret);
  let sigsMatch = false;
  try {
    sigsMatch = timingSafeEqual(
      Buffer.from(sigB64),
      Buffer.from(expectedSig),
    );
  } catch {
    // Buffers have different lengths → signatures definitely don't match.
    sigsMatch = false;
  }

  if (!sigsMatch) return { valid: false, reason: "invalid" };

  let payload: JwtPayload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64).toString()) as JwtPayload;
  } catch {
    return { valid: false, reason: "malformed" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) return { valid: false, reason: "expired" };

  // Sliding refresh: issue a new token if the current one is close to expiry.
  const secondsRemaining = payload.exp - now;
  const refreshedToken =
    secondsRemaining < config.auth.jwtRefreshThresholdSeconds
      ? signJwt(payload.sub, omit(payload, "sub", "iat", "exp", "jti"))
      : undefined;

  return { valid: true, payload, refreshedToken };
}

// ---------------------------------------------------------------------------
// Fastify hook / middleware
// ---------------------------------------------------------------------------

/** Header name used to deliver a silently refreshed token back to the client. */
export const REFRESHED_TOKEN_HEADER = "x-refreshed-token";

/**
 * Fastify `preHandler` hook that enforces JWT authentication on a route.
 *
 * Usage:
 *   app.get('/protected', { preHandler: requireAuth }, handler)
 *
 * When `disableSessionAuth` is true (non-production only) the hook is a no-op.
 * If the token is within the refresh window the handler returns the new token
 * in the `X-Refreshed-Token` response header.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (config.auth.disableSessionAuth) return;

  const authHeader = request.headers.authorization;
  if (!authHeader) {
    reply.status(401).send({ error: "Missing Authorization header" });
    return;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    reply.status(401).send({ error: "Invalid Authorization header format" });
    return;
  }

  const result = verifyJwt(match[1]);

  if (!result.valid) {
    const status = result.reason === "expired" ? 401 : 403;
    reply.status(status).send({ error: `Token ${result.reason}` });
    return;
  }

  // Attach payload to the request for downstream handlers.
  (request as FastifyRequest & { jwtPayload?: JwtPayload }).jwtPayload =
    result.payload;

  // Forward a refreshed token if the sliding window triggered.
  if (result.refreshedToken) {
    reply.header(REFRESHED_TOKEN_HEADER, result.refreshedToken);
  }
}

// ---------------------------------------------------------------------------
// Startup guard
// ---------------------------------------------------------------------------

const INSECURE_DEFAULT_SECRET = "dev-secret-change-me";

/**
 * Call once during server startup.  Throws (and logs) if the configuration is
 * unsafe for production use.
 *
 * Rules:
 *   - In production: `disableSessionAuth` must be false.
 *   - In production: `jwtSecret` must not be the insecure default value.
 */
export function assertAuthConfig(): void {
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && config.auth.disableSessionAuth) {
    const msg =
      "[auth] FATAL: DISABLE_SESSION_AUTH=true is not allowed in production. " +
      "Remove the environment variable before deploying.";
    console.error(msg);
    throw new Error(msg);
  }

  if (isProduction && config.auth.jwtSecret === INSECURE_DEFAULT_SECRET) {
    const msg =
      "[auth] FATAL: JWT_SECRET is set to the insecure development default. " +
      "Set a strong secret in the JWT_SECRET environment variable before deploying.";
    console.error(msg);
    throw new Error(msg);
  }

  if (!isProduction && config.auth.disableSessionAuth) {
    console.warn(
      "[auth] WARNING: Session authentication is disabled (DISABLE_SESSION_AUTH=true). " +
        "This is only acceptable in non-production environments.",
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function omit<T extends Record<string, unknown>>(
  obj: T,
  ...keys: string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!keys.includes(k)) result[k] = v;
  }
  return result;
}
