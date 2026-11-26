import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared network enum — single source of truth for all route schemas.
// Re-exported for backward compatibility with replay.validator.ts consumers.
// ---------------------------------------------------------------------------

export const ALLOWED_NETWORKS = [
  "mainnet",
  "testnet",
  "futurenet",
  "standalone",
  "local",
] as const;

export type AllowedNetwork = (typeof ALLOWED_NETWORKS)[number];

export const networkEnum = z.enum(ALLOWED_NETWORKS);

// ---------------------------------------------------------------------------
// Session routes
// ---------------------------------------------------------------------------

/** POST /api/session */
export const sessionCreateBodySchema = z.object({
  txHash: z
    .string()
    .length(64)
    .regex(/^[0-9a-fA-F]{64}$/, "txHash must be a 64-character hexadecimal string"),
  network: networkEnum,
  wsUrl: z.string().url("wsUrl must be a valid URL"),
});

/** PATCH /api/session/:sessionId/snapshot */
export const sessionSnapshotBodySchema = z.object({
  snapshot: z.object({
    ledger_sequence: z.number(),
    nodes: z.array(z.unknown()),
    state_diff: z.array(z.unknown()),
    completed: z.boolean(),
    resource_profile: z.record(z.unknown()).nullable().optional(),
    error: z.string().optional(),
  }),
});

// ---------------------------------------------------------------------------
// Replay routes
// ---------------------------------------------------------------------------

/** POST /api/replay */
export const replayPostBodySchema = z.object({
  txHash: z
    .string()
    .length(64)
    .regex(/^[0-9a-fA-F]{64}$/, "txHash must be a 64-character hexadecimal string"),
  network: networkEnum.default("testnet"),
});

export type ReplayPostBody = z.infer<typeof replayPostBodySchema>;

// ---------------------------------------------------------------------------
// Cache routes
// ---------------------------------------------------------------------------

/** DELETE /cache/:key */
export const cacheDeleteParamsSchema = z.object({
  key: z.string().min(1, "Cache key must not be empty"),
});

// ---------------------------------------------------------------------------
// AI routes
// ---------------------------------------------------------------------------

/** POST /api/ai/explain */
export const aiExplainBodySchema = z.object({
  report: z.record(z.unknown()),
  tx_hash: z.string().min(1, "tx_hash must not be empty"),
  network: z.string().min(1, "network must not be empty"),
});

/** DELETE /api/ai/cache/:txHash */
export const aiCacheDeleteParamsSchema = z.object({
  txHash: z.string().min(1, "txHash must not be empty"),
});
