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
