/**
 * WASM bridge — loads, initializes, and manages the Prism WebAssembly runtime.
 */

export class WasmLoadError extends Error {
  constructor(
    message: string = "Failed to load WebAssembly module.",
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "WasmLoadError";
  }
}

export type SorobanValueType =
  | "bool"
  | "u32"
  | "i32"
  | "u64"
  | "i64"
  | "u128"
  | "i128"
  | "u256"
  | "i256"
  | "address"
  | "bytes"
  | "string"
  | "symbol"
  | "vec"
  | "map"
  | "void";

const INTEGER_BOUNDS: Partial<Record<SorobanValueType, [bigint, bigint]>> = {
  u32: [BigInt(0), BigInt(2) ** BigInt(32) - BigInt(1)],
  i32: [-(BigInt(2) ** BigInt(31)), BigInt(2) ** BigInt(31) - BigInt(1)],
  u64: [BigInt(0), BigInt(2) ** BigInt(64) - BigInt(1)],
  i64: [-(BigInt(2) ** BigInt(63)), BigInt(2) ** BigInt(63) - BigInt(1)],
  u128: [BigInt(0), BigInt(2) ** BigInt(128) - BigInt(1)],
  i128: [-(BigInt(2) ** BigInt(127)), BigInt(2) ** BigInt(127) - BigInt(1)],
  u256: [BigInt(0), BigInt(2) ** BigInt(256) - BigInt(1)],
  i256: [-(BigInt(2) ** BigInt(255)), BigInt(2) ** BigInt(255) - BigInt(1)],
};

export function validateScVal(
  value: string,
  type: SorobanValueType,
): string | null {
  const trimmed = value.trim();
  const integerBounds = INTEGER_BOUNDS[type];

  if (integerBounds) {
    if (!/^-?\d+$/.test(trimmed)) {
      return `Expected a ${type} integer.`;
    }

    const parsed = BigInt(trimmed);
    if (parsed < integerBounds[0] || parsed > integerBounds[1]) {
      return `Value is outside the ${type} range (${integerBounds[0]} to ${integerBounds[1]}).`;
    }
    return null;
  }

  switch (type) {
    case "bool":
      return trimmed === "true" || trimmed === "false"
        ? null
        : 'Expected "true" or "false".';
    case "address":
      return /^[GC][A-Z2-7]{55}$/.test(trimmed)
        ? null
        : "Expected a Stellar account (G...) or contract (C...) address.";
    case "bytes":
      return /^(0x)?([\da-fA-F]{2})*$/.test(trimmed)
        ? null
        : "Expected an even-length hexadecimal byte string.";
    case "string":
      return null;
    case "symbol":
      return /^[A-Za-z0-9_]{1,32}$/.test(trimmed)
        ? null
        : "Expected a Soroban symbol (1-32 letters, digits, or underscores).";
    case "vec":
    case "map": {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        const valid = type === "vec" ? Array.isArray(parsed) : isRecord(parsed);
        return valid ? null : `Expected a JSON ${type === "vec" ? "array" : "object"}.`;
      } catch {
        return `Expected a valid JSON ${type === "vec" ? "array" : "object"}.`;
      }
    }
    case "void":
      return trimmed === "" ? null : "Expected an empty value for void.";
  }
  return null;
}

export interface ParsedScVal {
  type: SorobanValueType;
  value: unknown;
}

/** Parse an editor field without rounding wide integers. */
export function parseScValJson(source: string, type: SorobanValueType): ParsedScVal {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("Enter valid JSON.");
  }

  const integerBounds = INTEGER_BOUNDS[type];
  if (integerBounds) {
    if (typeof value !== "number" && typeof value !== "string") {
      throw new Error(`Expected a ${type} integer.`);
    }
    const integer = typeof value === "number" ? source.trim() : value;
    if (!/^-?\d+$/.test(integer)) {
      throw new Error(`Expected a ${type} integer in decimal notation.`);
    }
    const error = validateScVal(integer, type);
    if (error) throw new Error(error);
    return { type, value: type === "u32" || type === "i32" ? Number(integer) : BigInt(integer).toString() };
  }

  if (type === "void" && value === null) return { type, value };
  if (type === "bool" && typeof value === "boolean") return { type, value };
  if (type === "vec" || type === "map") {
    const error = validateScVal(source, type);
    if (error) throw new Error(error);
    JSON.parse(source, (_key, entry: unknown) => {
      if (typeof entry === "number" && !Number.isSafeInteger(entry)) {
        throw new Error("Use quoted decimal strings for large integers. ScVal has no floating-point type.");
      }
      return entry;
    });
    return { type, value };
  }
  if (
    (type === "address" || type === "bytes" || type === "string" || type === "symbol") &&
    typeof value === "string"
  ) {
    const error = validateScVal(value, type);
    if (error) throw new Error(error);
    return {
      type,
      value: type === "bytes" ? value.trim().replace(/^0x/, "").toLowerCase()
        : type === "string" ? value : value.trim(),
    };
  }
  const expected = type === "void" ? "null" : type === "bool" ? "a boolean" : "a quoted string";
  throw new Error(`Expected ${expected} for ${type}.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

let wasmInstance: unknown = null;
let wasmInitPromise: Promise<unknown> | null = null;
let wasmInitError: Error | null = null;
let simulateWasmFailure = false;

/**
 * Configure simulation of WASM loading failures (useful for automated testing or UI error states).
 */
export function setSimulateWasmFailure(simulate: boolean): void {
  simulateWasmFailure = simulate;
  if (simulate) {
    wasmInstance = null;
    wasmInitPromise = null;
  }
}

/**
 * Returns true if the WASM module is currently initialized and ready.
 */
export function isWasmLoaded(): boolean {
  return wasmInstance !== null && wasmInitError === null;
}

/**
 * Returns the latest error encountered during WASM initialization, if any.
 */
export function getWasmError(): Error | null {
  return wasmInitError;
}

/**
 * Initializes the WASM module. If initialization fails, throws a WasmLoadError.
 *
 * @param forceReload Whether to force a fresh reload even if already initialized.
 */
export async function initWasm(forceReload = false): Promise<unknown> {
  if (forceReload) {
    wasmInstance = null;
    wasmInitPromise = null;
    wasmInitError = null;
  }

  if (wasmInstance && !forceReload) {
    return wasmInstance;
  }

  if (wasmInitPromise && !forceReload) {
    return wasmInitPromise;
  }

  wasmInitPromise = (async () => {
    try {
      if (
        simulateWasmFailure ||
        (typeof window !== "undefined" &&
          (window as unknown as { __PRISM_FORCE_WASM_ERROR__?: boolean })
            .__PRISM_FORCE_WASM_ERROR__)
      ) {
        throw new WasmLoadError(
          "WebAssembly bundle failed to load: simulated failure triggered."
        );
      }

      // In browser environments with dynamic wasm bundle available, attempt dynamic loading
      try {
        const wasmPath = "/wasm/grat_wasm.js";
        const importModule = new Function("path", "return import(path)");
        const wasmModule = await importModule(wasmPath).catch(() => null);

        if (wasmModule && typeof wasmModule.default === "function") {
          await wasmModule.default();
          wasmInstance = wasmModule;
          wasmInitError = null;
          return wasmInstance;
        }
      } catch {
        // Fall back to stub / built-in runtime
      }

      // Fallback runtime stub
      wasmInstance = {
        initialized: true,
        decodeError: async () => ({ status: "not_yet_implemented" }),
      };
      wasmInitError = null;
      return wasmInstance;
    } catch (err) {
      const error =
        err instanceof WasmLoadError
          ? err
          : new WasmLoadError(
              err instanceof Error
                ? err.message
                : "Failed to initialize WebAssembly runtime."
            );
      wasmInitError = error;
      wasmInstance = null;
      throw error;
    }
  })();

  return wasmInitPromise;
}

/**
 * Reloads the WASM module by resetting existing state and re-running initialization.
 */
export async function reloadWasm(): Promise<unknown> {
  return initWasm(true);
}

/**
 * Calls into the WASM module to decode a transaction result XDR.
 */
export async function decodeError(txResultXdr: string): Promise<unknown> {
  await initWasm();
  return { status: "not_yet_implemented", txResultXdr };
}

export const stellarXdrTypes = [
  "TransactionEnvelope",
  "TransactionResult",
  "TransactionMeta",
  "DiagnosticEvent",
  "ScVal",
] as const;

export type StellarXdrType = (typeof stellarXdrTypes)[number];

export function readXdrBase64(source: string): string {
  const base64 = source.replace(/\s/g, "");
  if (!base64 || base64.length > Math.ceil((4 * 1024 * 1024) / 3) * 4) {
    throw new Error("Enter a base64 value of up to 4 MiB of XDR.");
  }
  try {
    return atob(base64);
  } catch {
    throw new Error("Invalid base64 XDR.");
  }
}

export async function prettyPrintXdr(
  source: string,
  type: StellarXdrType,
): Promise<string> {
  const bytes = Uint8Array.from(readXdrBase64(source), (byte) => byte.charCodeAt(0));
  const wasm = (await initWasm()) as {
    decode_xdr?: (type: StellarXdrType, bytes: Uint8Array) => string;
  };
  if (!wasm.decode_xdr) {
    throw new WasmLoadError("The WebAssembly XDR decoder is unavailable.");
  }
  try {
    return wasm.decode_xdr(type, bytes);
  } catch {
    throw new Error(`Unable to decode the XDR as ${type}.`);
  }
}
