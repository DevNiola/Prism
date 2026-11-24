export const ALLOWED_NETWORKS = [
  "mainnet",
  "testnet",
  "futurenet",
  "standalone",
  "local",
] as const;

export type AllowedNetwork = typeof ALLOWED_NETWORKS[number];

export interface ReplayInput {
  txHash: string;
  network?: string;
  [key: string]: unknown;
}

export interface ValidatedReplayInput {
  txHash: string;
  network: AllowedNetwork;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitized?: ValidatedReplayInput;
}

/**
 * Sanitize user input by trimming whitespace and removing illegal or non-printable ASCII characters.
 */
export function sanitizeString(val: unknown): string {
  if (typeof val !== "string") {
    return "";
  }
  // Remove control characters (except common whitespace) and trim
  return val.replace(/[\x00-\x1F\x7F]/g, "").trim();
}

/**
 * Validates replay request payload:
 * - Checks txHash is exactly 64 hexadecimal characters.
 * - Checks network is one of the supported networks.
 * - Sanitizes all input strings.
 */
export function validateReplayInput(body: unknown): ValidationResult {
  if (!body || typeof body !== "object") {
    return {
      valid: false,
      error: "Invalid request payload: expected a JSON object with 'txHash' and 'network'",
    };
  }

  const payload = body as Record<string, unknown>;

  const rawTxHash = sanitizeString(payload.txHash);
  if (!rawTxHash) {
    return {
      valid: false,
      error: "Missing required parameter 'txHash'",
    };
  }

  const hexRegex = /^[0-9a-fA-F]{64}$/;
  if (!hexRegex.test(rawTxHash)) {
    return {
      valid: false,
      error: `Invalid 'txHash' format: expected a 64-character hexadecimal transaction hash, got '${rawTxHash}'`,
    };
  }

  const rawNetwork = sanitizeString(payload.network || "testnet").toLowerCase();
  if (!ALLOWED_NETWORKS.includes(rawNetwork as AllowedNetwork)) {
    return {
      valid: false,
      error: `Invalid 'network': '${rawNetwork}' is not supported. Allowed networks: ${ALLOWED_NETWORKS.join(", ")}`,
    };
  }

  return {
    valid: true,
    sanitized: {
      txHash: rawTxHash.toLowerCase(),
      network: rawNetwork as AllowedNetwork,
    },
  };
}
