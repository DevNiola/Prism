# WebSocket Trace Stream Protocol

This document describes the WebSocket-based streaming protocol used by the Grat server to deliver real-time transaction trace events to clients. By the end of this document you should have enough information to write a fully functional WebSocket consumer from scratch.

---

## Overview

When the Grat server executes a trace or replay, it streams progress events in real time over a persistent WebSocket connection. Each event is a JSON object with a `type` discriminant field and event-specific payload fields.

The server is implemented in `apps/server/src/ws/trace-stream.ts`. The HTTP/WebSocket server runs via Fastify on port **3001** by default (configurable via the `PORT` environment variable).

---

## Connection

### URL

```
ws://<host>:<port>/ws/trace
```

**Default (local development):**
```
ws://localhost:3001/ws/trace
```

**Production / hosted:**
```
wss://your-grat-server.example.com/ws/trace
```

> Use `wss://` (TLS) in any production or remote environment.

### Authentication

The current implementation does not require authentication headers on the initial WebSocket handshake. If your deployment sits behind an API gateway or reverse proxy that enforces bearer tokens, pass the token as a query parameter or a custom header at the HTTP upgrade request level — this is outside the scope of the Grat protocol itself.

### Connection Lifecycle

```
Client                                     Server
  │                                           │
  │──── HTTP GET /ws/trace (Upgrade: WS) ────▶│
  │◀─── 101 Switching Protocols ─────────────│
  │                                           │
  │──── subscribe message ──────────────────▶│
  │◀─── subscribed acknowledgement ──────────│
  │                                           │
  │◀─── trace_started ───────────────────────│
  │◀─── trace_node (×N) ─────────────────────│
  │◀─── resource_update (every 10 nodes) ────│
  │◀─── state_diff_entry (×M) ───────────────│
  │◀─── trace_completed ──────────────────── │
  │                                           │
  │   (connection stays open for reuse)       │
```

---

## Client → Server Messages

### Subscribe

Sent immediately after connecting to begin a trace. The server will not send any trace events until it receives this message.

```json
{
  "type": "subscribe",
  "tx_hash": "a3f9c1..."
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `type` | `"subscribe"` | ✅ | Message discriminant |
| `tx_hash` | `string` | ✅ | Hex-encoded transaction hash to trace |

The server responds with a `subscribed` acknowledgement (see below) before beginning to stream events.

---

## Server → Client Messages

All server messages are JSON objects. Every message includes a `type` field and an optional `trace_id` field that uniquely identifies the trace session.

### Common Fields

| Field | Type | Present on | Description |
|---|---|---|---|
| `type` | `string` | All | Event type discriminant |
| `trace_id` | `string` | Most events | UUID identifying this trace session |

---

### `subscribed`

Sent immediately after the server receives a valid `subscribe` message. Confirms the trace has been queued.

```json
{
  "type": "subscribed",
  "tx_hash": "a3f9c1..."
}
```

| Field | Type | Description |
|---|---|---|
| `type` | `"subscribed"` | Message discriminant |
| `tx_hash` | `string` | Echo of the requested transaction hash |

---

### `trace_started`

Sent once when the server begins executing the trace. Use this event to initialize your UI state (e.g., show a loading indicator, reset any previous results).

```json
{
  "type": "trace_started",
  "trace_id": "550e8400-e29b-41d4-a716-446655440000",
  "tx_hash": "a3f9c1...",
  "ledger_sequence": 49523801,
  "timestamp": "2024-11-15T10:22:45Z"
}
```

| Field | Type | Description |
|---|---|---|
| `type` | `"trace_started"` | Message discriminant |
| `trace_id` | `string` | UUID for this trace session |
| `tx_hash` | `string` | Transaction hash being traced |
| `ledger_sequence` | `number` | Ledger at which the transaction was included |
| `timestamp` | `string` | ISO 8601 timestamp of trace start |

---

### `trace_node`

Sent once per execution step as the replay engine walks the call tree. Nodes arrive in execution order. Expect **N** of these messages per trace, where N depends on the contract's complexity.

The server introduces a **5 ms throttle** between consecutive `trace_node` messages to avoid overwhelming clients with large traces.

```json
{
  "type": "trace_node",
  "trace_id": "550e8400-e29b-41d4-a716-446655440000",
  "index": 0,
  "event": "contract_invocation",
  "path": "TokenContract::transfer",
  "data": {
    "from": "GABC...XYZ",
    "to":   "GDEF...UVW",
    "amount": "1000000000"
  },
  "depth": 0,
  "cpu_instructions": 12540,
  "memory_bytes": 4096
}
```

| Field | Type | Description |
|---|---|---|
| `type` | `"trace_node"` | Message discriminant |
| `trace_id` | `string` | Trace session UUID |
| `index` | `number` | Zero-based sequential node index |
| `event` | `string` | Event category (e.g., `contract_invocation`, `host_function`, `inner_call`) |
| `path` | `string` | Human-readable call path (`ContractName::method`) |
| `data` | `object` | Decoded arguments and contextual data for this step |
| `depth` | `number` | Call stack depth (0 = top-level invocation) |
| `cpu_instructions` | `number` | Cumulative CPU instructions consumed at this node |
| `memory_bytes` | `number` | Cumulative memory bytes consumed at this node |

---

### `resource_update`

Sent approximately **every 10 trace nodes** as a periodic budget progress report. Use this to update progress bars or budget consumption gauges without processing every individual node.

```json
{
  "type": "resource_update",
  "trace_id": "550e8400-e29b-41d4-a716-446655440000",
  "nodes_processed": 10,
  "cpu_instructions_used": 125400,
  "cpu_instructions_limit": 10000000,
  "memory_bytes_used": 40960,
  "memory_bytes_limit": 41943040,
  "cpu_percent": 1.25,
  "memory_percent": 0.10
}
```

| Field | Type | Description |
|---|---|---|
| `type` | `"resource_update"` | Message discriminant |
| `trace_id` | `string` | Trace session UUID |
| `nodes_processed` | `number` | Total trace nodes processed so far |
| `cpu_instructions_used` | `number` | CPU instructions consumed so far |
| `cpu_instructions_limit` | `number` | Soroban protocol CPU budget limit |
| `memory_bytes_used` | `number` | Memory bytes consumed so far |
| `memory_bytes_limit` | `number` | Soroban protocol memory budget limit |
| `cpu_percent` | `number` | `(cpu_instructions_used / cpu_instructions_limit) * 100` |
| `memory_percent` | `number` | `(memory_bytes_used / memory_bytes_limit) * 100` |

---

### `state_diff_entry`

Sent once per changed ledger entry after the replay is complete. These represent the difference between the pre-execution and post-execution ledger state. Expect **M** messages where M is the number of ledger entries modified.

```json
{
  "type": "state_diff_entry",
  "trace_id": "550e8400-e29b-41d4-a716-446655440000",
  "index": 0,
  "key": "Contract(CABC...XYZ)/Balance/GABC...XYZ",
  "change_type": "updated",
  "before": "1000000000",
  "after": "900000000"
}
```

| Field | Type | Description |
|---|---|---|
| `type` | `"state_diff_entry"` | Message discriminant |
| `trace_id` | `string` | Trace session UUID |
| `index` | `number` | Zero-based entry index |
| `key` | `string` | Ledger key identifying the affected entry |
| `change_type` | `"created"` \| `"updated"` \| `"deleted"` | Nature of the change |
| `before` | `string \| null` | JSON-encoded value before execution (`null` for `created`) |
| `after` | `string \| null` | JSON-encoded value after execution (`null` for `deleted`) |

---

### `trace_completed`

Sent once after all `trace_node` and `state_diff_entry` messages have been delivered. This is the terminal success event — use it to finalize your UI, hide loading indicators, and enable export controls.

The connection **stays open** after `trace_completed`. You may send another `subscribe` message to begin a new trace on the same connection.

```json
{
  "type": "trace_completed",
  "trace_id": "550e8400-e29b-41d4-a716-446655440000",
  "tx_hash": "a3f9c1...",
  "total_nodes": 347,
  "total_diff_entries": 12,
  "duration_ms": 4821,
  "cpu_instructions_used": 4327880,
  "memory_bytes_used": 1048576
}
```

| Field | Type | Description |
|---|---|---|
| `type` | `"trace_completed"` | Message discriminant |
| `trace_id` | `string` | Trace session UUID |
| `tx_hash` | `string` | Transaction hash that was traced |
| `total_nodes` | `number` | Total number of `trace_node` events sent |
| `total_diff_entries` | `number` | Total number of `state_diff_entry` events sent |
| `duration_ms` | `number` | Wall-clock time for the full trace in milliseconds |
| `cpu_instructions_used` | `number` | Final CPU instruction count |
| `memory_bytes_used` | `number` | Final memory byte count |

---

### `trace_error`

Sent if the trace fails at any point. This is the terminal failure event. The server will not send any further messages for this trace after `trace_error`.

```json
{
  "type": "trace_error",
  "trace_id": "550e8400-e29b-41d4-a716-446655440000",
  "tx_hash": "a3f9c1...",
  "error": "Failed to reconstruct ledger state: RPC node unavailable",
  "error_code": "RPC_ERROR"
}
```

| Field | Type | Description |
|---|---|---|
| `type` | `"trace_error"` | Message discriminant |
| `trace_id` | `string` | Trace session UUID (may be `undefined` if the error occurs before the trace is assigned an ID) |
| `tx_hash` | `string` | Transaction hash that failed |
| `error` | `string` | Human-readable error description |
| `error_code` | `string` | Machine-readable error code (see [Error Codes](#error-codes)) |

---

## Heartbeat / Ping-Pong

The server uses the **WebSocket protocol-level ping/pong frames** (RFC 6455 §5.5.2–5.5.3) for keep-alive. You do not need to send application-level heartbeat messages.

- The server sends a **ping frame** every **30 seconds** of inactivity on the connection.
- Compliant WebSocket clients respond automatically with a **pong frame**.
- If no pong is received within **10 seconds** of a ping, the server closes the connection with code `1001` (Going Away).

Most WebSocket client libraries handle ping/pong automatically. If you are writing a low-level client:

```
← PING (opcode 0x9, no payload)
→ PONG (opcode 0xA, mirror ping payload)
```

---

## Event Order Guarantee

Events for a single trace are always delivered in this order:

```
subscribed
trace_started
trace_node[0]
trace_node[1]
...
resource_update   ← after every 10th node
...
trace_node[N-1]
state_diff_entry[0]
state_diff_entry[1]
...
state_diff_entry[M-1]
trace_completed
```

`trace_error` may appear at any point after `trace_started` if the replay fails mid-stream. No further messages are sent after a `trace_error`.

---

## Concurrent Sessions

Each WebSocket connection is independent. Multiple clients can trace the same or different transactions simultaneously — each connection has its own broadcast channel and trace task. There is no cross-client interference.

---

## Error Codes

| Code | Description |
|---|---|
| `TRANSACTION_NOT_FOUND` | The requested transaction hash does not exist on the network |
| `NOT_SOROBAN_TRANSACTION` | The transaction does not contain an `InvokeHostFunction` operation |
| `RPC_ERROR` | The Soroban RPC node returned an error response |
| `NETWORK_TIMEOUT` | The RPC request timed out |
| `STATE_RECONSTRUCTION_FAILED` | The server could not rebuild the historical ledger state |
| `XDR_DECODE_ERROR` | The transaction XDR could not be decoded |
| `INTERNAL_ERROR` | An unexpected server-side error occurred |

---

## Client Implementation Example (JavaScript)

The following minimal example demonstrates subscribing, handling all event types, and reconnecting on disconnect.

```javascript
class GratTraceClient {
  constructor(serverUrl = "ws://localhost:3001/ws/trace") {
    this.serverUrl = serverUrl;
    this.ws = null;
    this.handlers = {};
  }

  on(eventType, handler) {
    this.handlers[eventType] = handler;
    return this;
  }

  connect() {
    this.ws = new WebSocket(this.serverUrl);

    this.ws.addEventListener("open", () => {
      console.log("Connected to Grat trace stream");
    });

    this.ws.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        console.error("Received non-JSON message:", event.data);
        return;
      }

      const handler = this.handlers[msg.type];
      if (handler) handler(msg);
    });

    this.ws.addEventListener("close", (event) => {
      console.log(`Disconnected (code ${event.code}). Reconnecting in 3s…`);
      setTimeout(() => this.connect(), 3000);
    });

    this.ws.addEventListener("error", (err) => {
      console.error("WebSocket error:", err);
    });
  }

  trace(txHash) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected");
    }
    this.ws.send(JSON.stringify({ type: "subscribe", tx_hash: txHash }));
  }
}

// Usage
const client = new GratTraceClient("ws://localhost:3001/ws/trace");

client
  .on("subscribed",        (msg) => console.log("Subscribed:", msg.tx_hash))
  .on("trace_started",     (msg) => console.log("Trace started:", msg.trace_id))
  .on("trace_node",        (msg) => console.log(`  [${msg.index}] ${msg.path}`))
  .on("resource_update",   (msg) => console.log(`  CPU: ${msg.cpu_percent.toFixed(1)}%`))
  .on("state_diff_entry",  (msg) => console.log(`  Diff: ${msg.key} (${msg.change_type})`))
  .on("trace_completed",   (msg) => console.log("Done! Nodes:", msg.total_nodes))
  .on("trace_error",       (msg) => console.error("Error:", msg.error));

client.connect();

// After connection is open:
client.trace("a3f9c1b2d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1");
```

---

## Client Implementation Example (TypeScript)

```typescript
type TraceEventType =
  | "subscribed"
  | "trace_started"
  | "trace_node"
  | "resource_update"
  | "state_diff_entry"
  | "trace_completed"
  | "trace_error";

interface BaseMessage {
  type: TraceEventType;
  trace_id?: string;
}

interface TraceNodeMessage extends BaseMessage {
  type: "trace_node";
  index: number;
  event: string;
  path: string;
  data: Record<string, unknown>;
  depth: number;
  cpu_instructions: number;
  memory_bytes: number;
}

interface ResourceUpdateMessage extends BaseMessage {
  type: "resource_update";
  nodes_processed: number;
  cpu_percent: number;
  memory_percent: number;
}

interface TraceCompletedMessage extends BaseMessage {
  type: "trace_completed";
  total_nodes: number;
  total_diff_entries: number;
  duration_ms: number;
}

interface TraceErrorMessage extends BaseMessage {
  type: "trace_error";
  error: string;
  error_code: string;
}

type TraceMessage =
  | BaseMessage
  | TraceNodeMessage
  | ResourceUpdateMessage
  | TraceCompletedMessage
  | TraceErrorMessage;

function connectAndTrace(txHash: string): void {
  const ws = new WebSocket("ws://localhost:3001/ws/trace");

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "subscribe", tx_hash: txHash }));
  });

  ws.addEventListener("message", (event: MessageEvent<string>) => {
    const msg = JSON.parse(event.data) as TraceMessage;

    switch (msg.type) {
      case "trace_started":
        console.log("Trace started:", msg.trace_id);
        break;
      case "trace_node": {
        const node = msg as TraceNodeMessage;
        console.log(`[${node.index}] ${node.path} (depth=${node.depth})`);
        break;
      }
      case "resource_update": {
        const update = msg as ResourceUpdateMessage;
        console.log(`CPU: ${update.cpu_percent.toFixed(1)}% | Mem: ${update.memory_percent.toFixed(1)}%`);
        break;
      }
      case "state_diff_entry":
        console.log("Diff:", msg);
        break;
      case "trace_completed": {
        const done = msg as TraceCompletedMessage;
        console.log(`Trace done in ${done.duration_ms}ms, ${done.total_nodes} nodes`);
        ws.close();
        break;
      }
      case "trace_error": {
        const err = msg as TraceErrorMessage;
        console.error(`Trace failed [${err.error_code}]: ${err.error}`);
        ws.close();
        break;
      }
    }
  });
}
```

---

## Message Size Reference

| Event | Typical Size | Frequency | Approximate Total |
|---|---|---|---|
| `subscribed` | ~80 bytes | 1 per session | Negligible |
| `trace_started` | ~200 bytes | 1 per trace | Negligible |
| `trace_node` | ~500 bytes | N nodes | N × 500 B |
| `resource_update` | ~150 bytes | Every 10 nodes | (N/10) × 150 B |
| `state_diff_entry` | ~300 bytes | M changes | M × 300 B |
| `trace_completed` | ~150 bytes | 1 per trace | Negligible |

**Example** — 1 000-node trace with 50 state changes:

```
trace_node × 1 000         = ~500 KB
resource_update × 100      = ~15 KB
state_diff_entry × 50      = ~15 KB
─────────────────────────────────────
Total                      ≈ 530 KB over ~5 s ≈ 106 KB/s
```

---

## Performance Notes

- **5 ms throttle** between consecutive `trace_node` messages prevents fast traces from overflowing client message queues.
- **Bounded broadcast channels** (capacity: 100 messages) on the server side prevent unbounded memory growth.
- Each trace runs in its own async task — heavy traces do not block other concurrent connections.
- Reconnecting clients need to re-subscribe; there is no server-side message replay buffer.
