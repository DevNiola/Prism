import type { FastifyRequest, FastifyReply } from "fastify";
import { createHmac } from "node:crypto";
import { config } from "../config";

export interface SessionJwtPayload {
  sessionId: string;
  txHash?: string;
  network?: string;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  return Buffer.from(base64, "base64").toString("utf-8");
}

/**
 * Sign a payload using HMAC SHA256 (JWT standard HS256).
 */
export function signSessionToken(
  payload: SessionJwtPayload,
  secret: string = config.jwtSecret,
  expiresInSec: number = 86400,
): string {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSec,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const data = `${encodedHeader}.${encodedPayload}`;

  const signature = createHmac("sha256", secret)
    .update(data)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${data}.${signature}`;
}

/**
 * Verify and decode a HS256 JWT session token.
 */
export function verifySessionToken(
  token: string,
  secret: string = config.jwtSecret,
): SessionJwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return null;
    }

    const [encodedHeader, encodedPayload, signature] = parts;
    const data = `${encodedHeader}.${encodedPayload}`;

    const expectedSignature = createHmac("sha256", secret)
      .update(data)
      .digest("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    if (signature !== expectedSignature) {
      return null;
    }

    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as SessionJwtPayload;
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp && payload.exp < now) {
      return null; // Expired
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Fastify preHandler hook for authenticating session endpoints.
 * Validates the JWT and ensures the client owns the requested session.
 */
export async function sessionAuthMiddleware(
  request: FastifyRequest<{ Params: { sessionId: string } }>,
  reply: FastifyReply,
) {
  // Configurable option to disable auth for development
  if (config.disableSessionAuth) {
    return;
  }

  const authHeader = request.headers.authorization;
  let token: string | null = null;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7).trim();
  } else if (typeof request.query === "object" && request.query && "token" in request.query) {
    token = String((request.query as any).token);
  }

  if (!token) {
    return reply.status(401).send({
      statusCode: 401,
      error: "Unauthorized",
      message: "Missing or invalid Authorization header. A valid session JWT Bearer token is required.",
    });
  }

  const payload = verifySessionToken(token, config.jwtSecret);
  if (!payload) {
    return reply.status(401).send({
      statusCode: 401,
      error: "Unauthorized",
      message: "Invalid or expired session token.",
    });
  }

  const targetSessionId = request.params?.sessionId;
  if (targetSessionId && payload.sessionId !== targetSessionId) {
    return reply.status(403).send({
      statusCode: 403,
      error: "Forbidden",
      message: "Session token does not grant access to this session ID.",
    });
  }

  (request as any).sessionAuth = payload;
}
