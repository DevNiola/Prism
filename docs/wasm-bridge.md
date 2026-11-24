# WASM Bridge

The `crates/wasm` crate compiles the Prism (Grat) core engine to WebAssembly so the web application can decode Soroban transaction errors entirely in the browser — no server round-trip required.

---

## How It Works

```
┌─────────────────────────────────────────┐
│              Browser / Node             │
│                                         │
│  import init, { decode_error }          │
│      from "@grat-soroban/grat-wasm";    │
│                                         │
│  await init();          // load .wasm   │
│  const report = decode_error(json);     │
└────────────────┬────────────────────────┘
                 │  wasm-bindgen JS glue
                 ▼
┌─────────────────────────────────────────┐
│           grat-wasm (Rust / WASM)       │
│                                         │
│  decode_error(tx_result_json: &str)     │
│    → parse JSON                         │
│    → classify error                     │
│    → build_report (grat-core)           │
│    → serde_wasm_bindgen → JsValue       │
└─────────────────────────────────────────┘
```

The crate acts as a thin adapter layer: it accepts JSON strings from JavaScript, delegates all business logic to `grat-core`, and serializes the `DiagnosticReport` result back to a JavaScript value using `serde-wasm-bindgen`.

---

## Build Process

### Prerequisites

```bash
# Install wasm-pack (one-time)
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# Or via cargo
cargo install wasm-pack
```

Ensure the `wasm32-unknown-unknown` target is installed:

```bash
rustup target add wasm32-unknown-unknown
```

### Build for the Web

```bash
cd crates/wasm
wasm-pack build --target web --release
```

This produces a `pkg/` directory containing:

| File | Description |
|---|---|
| `grat_wasm_bg.wasm` | Compiled WASM binary |
| `grat_wasm.js` | JS glue code (imports/exports) |
| `grat_wasm.d.ts` | TypeScript type definitions |
| `package.json` | npm package metadata |

### Build Targets

| Target | Use Case | Command |
|---|---|---|
| `web` | ES module in a browser | `--target web` |
| `bundler` | Webpack/Vite/Rollup pipelines | `--target bundler` |
| `nodejs` | Node.js (CommonJS) | `--target nodejs` |
| `no-modules` | Plain `<script>` tags | `--target no-modules` |

The web app uses `--target web` (ES modules loaded via dynamic `import()`).

### Development Build

```bash
wasm-pack build --target web --dev
```

The `--dev` flag disables WASM optimizations for faster incremental compilation and includes debug symbols.

---

## Exported JS Bindings (`lib.rs`)

All public functions annotated with `#[wasm_bindgen]` are exported to JavaScript.

### `init()`

```rust
#[wasm_bindgen(start)]
pub fn init() {}
```

Called automatically when the WASM module is first loaded. Use this to initialize any global state. The `(start)` attribute ensures it runs before any other exported function is callable.

**JS usage:**

```js
import init from "@grat-soroban/grat-wasm";
await init(); // must be awaited before calling other functions
```

### `decode_error(tx_result_json: &str) → JsValue`

```rust
#[wasm_bindgen]
pub fn decode_error(tx_result_json: &str) -> Result<JsValue, JsValue>
```

The primary entry point. Accepts a JSON string describing a failed Soroban transaction and returns a serialized `DiagnosticReport`.

**Input JSON fields:**

| Field | Type | Description |
|---|---|---|
| `errorType` | `string` | Error category: `"Budget"`, `"Storage"`, `"Auth"`, `"ContractError"`, etc. |
| `errorCode` | `number` | Numeric error code |
| `isContractError` | `boolean` | `true` if the error originated from contract logic |
| `contractId` | `string` | Strkey-encoded contract ID (optional) |
| `rawData` | `object` | Raw XDR result data (optional) |
| `diagnosticEventsXdr` | `string[]` | Base64-encoded XDR diagnostic events (optional) |
| `rootCauses` | `object[]` | Pre-computed root causes (optional override) |
| `suggestedFixes` | `object[]` | Pre-computed fix suggestions (optional override) |
| `txHash` | `string` | Transaction hash (optional) |
| `ledgerSequence` | `number` | Ledger sequence number (optional) |

**JS usage:**

```js
import init, { decode_error } from "@grat-soroban/grat-wasm";

await init();

const report = decode_error(JSON.stringify({
  errorType: "Budget",
  errorCode: 10,
  rawData: {}
}));

console.log(report.human_readable);   // "CPU instructions budget exceeded"
console.log(report.suggested_fixes);  // [{ description: "...", difficulty: "medium" }]
```

**Error handling:**

```js
try {
  const report = decode_error(invalidJson);
} catch (e) {
  // e is a string: "invalid JSON input: ..."
}
```

Errors are returned as `Err(JsValue::from_str(...))`, which `wasm-bindgen` converts to a thrown JavaScript exception.

### `resolve_contract_error(wasm_bytes: &[u8], error_code: u32) → JsValue`

```rust
#[wasm_bindgen]
pub fn resolve_contract_error(wasm_bytes: &[u8], error_code: u32) -> Result<JsValue, JsValue>
```

Resolves a custom contract error code (e.g., `#3`) to a human-readable name by inspecting the contract's WASM metadata. Currently returns `{ "status": "not_yet_implemented" }` — this is a placeholder pending full WASM metadata parsing.

**JS usage:**

```js
const result = resolve_contract_error(wasmBytes, 3);
// { status: "not_yet_implemented" }
```

### `version() → string`

```rust
#[wasm_bindgen]
pub fn version() -> String
```

Returns the crate version string from `Cargo.toml` at compile time.

```js
import { version } from "@grat-soroban/grat-wasm";
console.log(version()); // "0.1.0"
```

---

## Serialization: Rust ↔ JavaScript

### `serde-wasm-bindgen`

The bridge uses [`serde-wasm-bindgen`](https://docs.rs/serde-wasm-bindgen) to convert Rust structs directly to JS objects without an intermediate JSON string. This is more efficient than `serde_json::to_string` + `JSON.parse` because it operates on the JS heap directly.

```rust
// Serialize a Rust struct to a JS object
serde_wasm_bindgen::to_value(&report)
    .map_err(|e| JsValue::from_str(&e.to_string()))
```

```rust
// Deserialize a JS value to a Rust struct
let value: MyStruct = serde_wasm_bindgen::from_value(js_val)
    .map_err(|e| JsValue::from_str(&e.to_string()))?;
```

### Serialization Rules

| Rust Type | JS Type |
|---|---|
| `String` | `string` |
| `u32`, `i64`, etc. | `number` |
| `bool` | `boolean` |
| `Option<T>` | `T \| null` |
| `Vec<T>` | `Array` |
| `struct { field: T }` | `{ field: T }` |
| `enum Variant(T)` | `{ "Variant": T }` (by default) |

Enums can be customized with `#[serde(tag = "type")]` for tagged union style — check the structs in `grat-core/src/types/report.rs` for how `DiagnosticReport` is serialized.

---

## Adding New Functions to the WASM API

Follow these steps to expose new functionality from `grat-core` to JavaScript.

### 1. Add the function to `crates/wasm/src/lib.rs`

```rust
use wasm_bindgen::prelude::*;

/// Returns a JSON-serializable summary of resource usage.
#[wasm_bindgen]
pub fn get_resource_summary(tx_result_json: &str) -> Result<JsValue, JsValue> {
    let parsed: serde_json::Value = serde_json::from_str(tx_result_json)
        .map_err(|e| JsValue::from_str(&format!("invalid JSON: {e}")))?;

    // Call into grat-core
    let summary = grat_core::some_module::compute_summary(&parsed)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    // Serialize to JS
    serde_wasm_bindgen::to_value(&summary)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}
```

Key rules:
- The function must be `pub` and annotated with `#[wasm_bindgen]`.
- Return types must be `Result<JsValue, JsValue>` (or a primitive type like `String`, `u32`).
- Complex types must implement `serde::Serialize`.
- The function **cannot** be `async` in the exported signature; use `wasm_bindgen_futures` for async work.

### 2. Implement async functions (if needed)

Use `wasm_bindgen_futures` to expose `async` functions as JS Promises:

```rust
use wasm_bindgen_futures::future_to_promise;
use js_sys::Promise;

#[wasm_bindgen]
pub fn fetch_transaction(tx_hash: String) -> Promise {
    future_to_promise(async move {
        let result = grat_core::network::fetch_tx(&tx_hash).await
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        serde_wasm_bindgen::to_value(&result)
            .map_err(|e| JsValue::from_str(&e.to_string()))
    })
}
```

Add `wasm-bindgen-futures` to `crates/wasm/Cargo.toml`:

```toml
[dependencies]
wasm-bindgen-futures = "0.4"
```

### 3. Ensure the core type is serializable

The type returned from `grat-core` must derive `serde::Serialize`:

```rust
// In grat-core
#[derive(serde::Serialize, serde::Deserialize)]
pub struct ResourceSummary {
    pub cpu_instructions_used: u64,
    pub memory_bytes_used: u64,
}
```

### 4. Rebuild and test

```bash
cd crates/wasm
wasm-pack build --target web --dev
```

Test in the browser or Node.js:

```js
const { get_resource_summary } = await import("./pkg/grat_wasm.js");
const summary = get_resource_summary(JSON.stringify({ ... }));
```

---

## WASM Size and Performance Notes

- The `--release` build enables `wasm-opt` (Binaryen optimizer) automatically via `wasm-pack`, significantly reducing binary size.
- Avoid pulling in large Rust crates that are not needed in the browser. The `wasm-compat` feature flag on `grat-core` excludes heavy native dependencies (`sled`, `reqwest`, etc.):

```toml
# crates/wasm/Cargo.toml
[dependencies]
grat-core = { workspace = true, features = ["wasm-compat"] }
```

- `web-sys` is included but should only be extended with features actually used. Unused `web-sys` features still add to compile time.

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `the trait Send is not implemented for JsValue` | `JsValue` is not thread-safe | Move WASM work to the main thread; don't use `tokio::spawn` with JsValue |
| `error: proc-macro crate is not available for target wasm32` | A proc-macro dep doesn't support WASM | Enable the `wasm-compat` feature to exclude the offending dep |
| `wasm-opt not found` | Missing `binaryen` tooling | `wasm-pack` bundles `wasm-opt`; ensure `wasm-pack` is up to date |
| `RuntimeError: unreachable` at runtime | Rust `panic!` reached | Add `console_error_panic_hook` to surface panic messages in the browser console |

To add panic messages in development:

```rust
// crates/wasm/src/lib.rs
#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(debug_assertions)]
    console_error_panic_hook::set_once();
}
```

```toml
# crates/wasm/Cargo.toml
[dependencies]
console_error_panic_hook = { version = "0.1", optional = true }

[features]
default = ["console-panic"]
console-panic = ["console_error_panic_hook"]
```
