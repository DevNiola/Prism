# WebSocket Trace Client

This example shows how to connect to the Prism server's WebSocket API to
receive a real-time stream of execution trace nodes, CPU/memory resource
updates, and ledger state-diff events for a specific Soroban transaction.

## What it demonstrates

- Establishing a WebSocket connection with proper lifecycle management
  (connect, message handling, graceful close).
- Requesting a trace stream by sending `{ "tx_hash": "<hash>" }` after the
  connection opens.
- Consuming the three event types emitted by the server:
  - `trace_node` — a single execution step in the call tree.
  - `resource_update` — CPU/memory budget snapshot at a given step.
  - `state_diff` — ledger entry changes caused by the transaction.
- Handling errors and connection failures gracefully.

## Prerequisites

- The Prism server must be running:
  ```bash
  pnpm --filter prism-server dev
  ```
- Node.js 18 or higher.

## Installation

```bash
pnpm install
# or
npm install
```

## Running the Example

Provide a real or mock transaction hash:

```bash
pnpm start <transaction_hash>
# or
npm start <transaction_hash>
```

### Example

```bash
pnpm start a1b2c3d4e5f6...
```

The script connects to `ws://localhost:3001` by default.  Override the server
address with the `WS_URL` environment variable:

```bash
WS_URL=ws://my-host:3001 pnpm start <tx_hash>
```

## How it works

1. A `TraceStreamClient` instance is created with the server URL and tx hash.
2. `client.connect()` opens the WebSocket and returns a Promise that resolves
   on the `open` event.
3. Once open, the client sends `{ "tx_hash": "<hash>" }` to subscribe to the
   trace stream for that transaction.
4. Incoming messages are parsed and dispatched by `type` field.
5. The connection is closed automatically when the server sends a `done` message
   or after a configurable timeout.
