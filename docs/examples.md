# Examples

The `examples/` directory contains runnable integration scripts that show how to use Prism from different environments. Each example is self-contained and can be run independently.

## Overview

| Example | Directory | Description |
|---------|-----------|-------------|
| [CLI Integration](#cli-integration) | `examples/cli-automation/cli-integration/` | Invoke the `prism` binary from Node.js |
| [WebSocket Trace Client](#websocket-trace-client) | `examples/api-clients/websocket-client/` | Stream live trace data over WebSocket |
| [Mock Replay Submitter](#mock-replay-submitter) | `examples/api-clients/mock-replay-submitter/` | Submit a replay job via REST and poll for results |
| [Fetch Taxonomy](#fetch-taxonomy) | `examples/core-integration/fetch-taxonomy/` | Parse the error taxonomy TOML and produce a JSON dictionary |

---

## CLI Integration

**Path:** `examples/cli-automation/cli-integration/`

Demonstrates how an external Node.js process (IDE extension, web-app backend, CI pipeline) can programmatically invoke the `prism decode` command and parse the JSON output.

**Key concepts:**
- Spawning the binary with `child_process.execFile` (no shell, no injection risk).
- Validating Base64 XDR input before passing it to the CLI.
- Consuming structured JSON diagnostic reports from stdout.

**Prerequisites:** Prism CLI built locally (`cargo build`), Node.js 18+.

```bash
cd examples/cli-automation/cli-integration
node index.js <base64_xdr_string>
```

See [examples/cli-automation/cli-integration/README.md](../examples/cli-automation/cli-integration/README.md) for full details.

---

## WebSocket Trace Client

**Path:** `examples/api-clients/websocket-client/`

Demonstrates how to connect to the Prism server WebSocket API and receive a real-time stream of execution trace nodes, resource usage snapshots, and ledger state diffs.

**Key concepts:**
- Managing WebSocket connection lifecycle (connect, subscribe, graceful close).
- Handling the three event types: `trace_node`, `resource_update`, `state_diff`.
- Reconnect and timeout handling.

**Prerequisites:** Prism server running (`pnpm --filter prism-server dev`), Node.js 18+.

```bash
cd examples/api-clients/websocket-client
pnpm install
pnpm start <transaction_hash>
```

See [examples/api-clients/websocket-client/README.md](../examples/api-clients/websocket-client/README.md) for full details.

---

## Mock Replay Submitter

**Path:** `examples/api-clients/mock-replay-submitter/`

Demonstrates how a CI/CD pipeline or external script can submit a transaction for replay via the Prism server REST API and poll for the job result.

**Key concepts:**
- Submitting `POST /api/replay` with a transaction hash.
- Polling `GET /api/replay/:token` until the job completes or fails.
- Printing the final diagnostic report as JSON.

**Prerequisites:** Prism server running (`pnpm --filter prism-server dev`), Node.js 18+ (uses native `fetch`).

```bash
cd examples/api-clients/mock-replay-submitter
npm start <transaction_hash>
```

See [examples/api-clients/mock-replay-submitter/README.md](../examples/api-clients/mock-replay-submitter/README.md) for full details.

---

## Fetch Taxonomy

**Path:** `examples/core-integration/fetch-taxonomy/`

Demonstrates how the Prism web app builds its Error Dictionary by parsing the Rust engine's source-of-truth TOML taxonomy files and flattening them into a single-level JSON dictionary for O(1) lookups.

**Key concepts:**
- Parsing `crates/core/src/taxonomy/data/contract.toml` with `@iarna/toml`.
- Recursively flattening nested namespace trees into a flat `{ code → definition }` map.
- Writing the result to `taxonomy.json` for frontend consumption.

**Prerequisites:** Node.js 18+.

```bash
cd examples/core-integration/fetch-taxonomy
pnpm install
npm start        # generates taxonomy.json
npm test         # runs the test suite
```

See [examples/core-integration/fetch-taxonomy/README.md](../examples/core-integration/fetch-taxonomy/README.md) for full details.
