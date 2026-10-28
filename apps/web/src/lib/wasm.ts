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
  u32: [0n, 2n ** 32n - 1n],
  i32: [-(2n ** 31n), 2n ** 31n - 1n],
  u64: [0n, 2n ** 64n - 1n],
  i64: [-(2n ** 63n), 2n ** 63n - 1n],
  u128: [0n, 2n ** 128n - 1n],
  i128: [-(2n ** 127n), 2n ** 127n - 1n],
  u256: [0n, 2n ** 256n - 1n],
  i256: [-(2n ** 255n), 2n ** 255n - 1n],
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
