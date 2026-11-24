# Grat Server API Reference

The Grat server is a [Fastify](https://fastify.dev/) application (TypeScript) that exposes REST endpoints and a WebSocket stream used by the Grat web dashboard and the CLI's `serve` bridge.

**Default base URL:** `http://localhost:3001`

---

## Table of Contents

- [Authentication](#authentication)
- [Error Response Format](#error-response-format)
- [Health](#health)
- [Replay](#replay)
- [Session](#session)
- [AI](#ai)
- [WebSocket Streaming](#websocket-streaming)

---

## Authentication

Most endpoints are public. Endpoints that mutate session state (`PATCH`, `POST /heartbeat`, `DELETE /session/:sessionId`) require a **Bearer token** that is issued when the session is created.

```
Authorization: Bearer <token>
```

The token is a secret issued only at session creation (`POST /api/session`). It is never returned by `GET /api/session/:sessionId`, so store it securely immediately after creation.

---

## Error Response Format

All error responses use a consistent JSON envelope:

```json
{
  "error": "Human-readable error message",
  "statusCode": 400
}
```

Rate-limit responses from the AI endpoints include additional fields:

```json
{
  "error": "Hourly token budget exceeded",
  "hourly_remaining": 0,
  "daily_remaining": 48000,
  "reset_at": "2026-10-21T01:00:00.000Z"
}
```

---

## Health

### `GET /health`

Returns the server status. Useful for load-balancer health checks.

**Request:** No body or headers required.

**Response `200 OK`:**

```json
{
  "status": "ok",
  "version": "0.1.0"
}
```

**Example:**

```bash
curl http://localhost:3001/health
```

---

## Replay

### `POST /api/replay`

Enqueues a transaction replay job. The job runs asynchronously; poll `GET /api/replay/:jobId` for status.

**Request Body:**

```json
{
  "txHash": "d5c3b2a1...a6f5e4d3c2",
  "network": "mainnet"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `txHash` | string | Yes | The transaction hash to replay |
| `network` | string | Yes | Network name: `mainnet`, `testnet`, `futurenet` |

**Response `200 OK`:**

```json
{
  "status": "queued"
}
```

**Example:**

```bash
curl -X POST http://localhost:3001/api/replay \
  -H "Content-Type: application/json" \
  -d '{"txHash": "d5c3b2a1...", "network": "testnet"}'
```

---

### `GET /api/replay/:jobId`

Polls the status of a previously enqueued replay job.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `jobId` | string | The job ID returned when the replay was enqueued |

**Response `200 OK`:**

```json
{
  "status": "pending"
}
```

Possible `status` values: `pending`, `running`, `completed`, `failed`.

**Example:**

```bash
curl http://localhost:3001/api/replay/job_abc123
```

---

## Session

A *session* is a shared state object created by the CLI and consumed by the web dashboard. The CLI creates a session when it starts a `replay`, then pushes trace snapshots as the replay progresses. The web dashboard polls the session to bootstrap or to reconnect.

### `POST /api/session`

Creates a new debug session. Returns a `sessionId` and a secret `token` that the CLI must include on subsequent authenticated calls.

**Request Body:**

```json
{
  "txHash": "d5c3b2a1...a6f5e4d3c2",
  "network": "testnet",
  "wsUrl": "ws://localhost:8080/ws"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `txHash` | string | Yes | Transaction being replayed in this session |
| `network` | string | Yes | Network name |
| `wsUrl` | string | Yes | WebSocket URL where trace stream can be consumed |

**Response `201 Created`:**

```json
{
  "sessionId": "ses_a1b2c3d4",
  "token": "tok_e5f6g7h8i9j0",
  "wsUrl": "ws://localhost:8080/ws",
  "createdAt": "2026-10-21T00:03:05.518Z"
}
```

> **Important:** Store `token` immediately — it is only returned on creation and never exposed again.

**Example:**

```bash
curl -X POST http://localhost:3001/api/session \
  -H "Content-Type: application/json" \
  -d '{
    "txHash": "d5c3b2a1...",
    "network": "testnet",
    "wsUrl": "ws://localhost:8080/ws"
  }'
```

---

### `GET /api/session/:sessionId`

Retrieves the public metadata for a session. The secret token is **not** returned here.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `sessionId` | string | The session ID to look up |

**Response `200 OK`:**

```json
{
  "status": "active",
  "session": {
    "sessionId": "ses_a1b2c3d4",
    "txHash": "d5c3b2a1...a6f5e4d3c2",
    "network": "testnet",
    "wsUrl": "ws://localhost:8080/ws",
    "createdAt": "2026-10-21T00:03:05.518Z",
    "snapshot": null
  }
}
```

**Response `404 Not Found`:**

```json
{
  "status": "not_found",
  "message": "Session 'ses_a1b2c3d4' does not exist or has expired."
}
```

**Example:**

```bash
curl http://localhost:3001/api/session/ses_a1b2c3d4
```

---

### `PATCH /api/session/:sessionId/snapshot`

Updates the trace snapshot stored on the session. The CLI calls this after each batch of streamed trace nodes so the frontend can bootstrap from a mid-stream state if it joins late or reconnects.

**Authentication:** `Authorization: Bearer <token>` (required)

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `sessionId` | string | The session to update |

**Request Body:**

```json
{
  "snapshot": {
    "ledger_sequence": 12345,
    "nodes": [ ... ],
    "resource_profile": {
      "cpu_used": 45230,
      "memory_used": 512048
    },
    "state_diff": [ ... ],
    "completed": false
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `snapshot.ledger_sequence` | number | Yes | Ledger sequence at time of snapshot |
| `snapshot.nodes` | array | Yes | Trace node events captured so far |
| `snapshot.resource_profile` | object\|null | No | Current resource usage |
| `snapshot.state_diff` | array | Yes | Ledger state changes recorded so far |
| `snapshot.completed` | boolean | Yes | Whether the replay has finished |
| `snapshot.error` | string | No | Error message if the replay failed |

**Response `200 OK`:**

```json
{ "status": "ok" }
```

**Response `401 Unauthorized`:**

```json
{ "error": "Missing Authorization header" }
```

**Response `403 Forbidden`:**

```json
{ "error": "Invalid or expired token" }
```

**Example:**

```bash
curl -X PATCH http://localhost:3001/api/session/ses_a1b2c3d4/snapshot \
  -H "Authorization: Bearer tok_e5f6g7h8i9j0" \
  -H "Content-Type: application/json" \
  -d '{
    "snapshot": {
      "ledger_sequence": 12345,
      "nodes": [],
      "resource_profile": null,
      "state_diff": [],
      "completed": false
    }
  }'
```

---

### `POST /api/session/:sessionId/heartbeat`

Resets the session's expiry timer. The CLI sends this periodically during long-running replays to prevent the session from expiring on the server.

**Authentication:** `Authorization: Bearer <token>` (required)

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `sessionId` | string | The session to keep alive |

**Response `200 OK`:**

```json
{
  "status": "ok",
  "updatedAt": "2026-10-21T00:05:00.000Z"
}
```

**Example:**

```bash
curl -X POST http://localhost:3001/api/session/ses_a1b2c3d4/heartbeat \
  -H "Authorization: Bearer tok_e5f6g7h8i9j0"
```

---

### `DELETE /api/session/:sessionId`

Deletes a session. The CLI calls this when the user stops the replay (e.g. `Ctrl+C`).

**Authentication:** `Authorization: Bearer <token>` (required)

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `sessionId` | string | The session to delete |

**Response `204 No Content`:** Empty body on success.

**Example:**

```bash
curl -X DELETE http://localhost:3001/api/session/ses_a1b2c3d4 \
  -H "Authorization: Bearer tok_e5f6g7h8i9j0"
```

---

## AI

The AI endpoints wrap an OpenAI-compatible LLM to generate human-friendly explanations of diagnostic reports. They enforce per-hour and per-day token budgets and deduplicate identical in-flight requests.

### `POST /api/ai/explain`

Submits a `DiagnosticReport` and returns an AI-generated explanation with plain English description and suggested fixes.

**Request Body:**

```json
{
  "report": {
    "error_category": "budget",
    "error_name": "CPUExceeded",
    "severity": "Error",
    "summary": "The transaction exceeded its CPU instruction budget.",
    "detailed_explanation": "...",
    "suggested_fixes": [ ... ]
  },
  "tx_hash": "d5c3b2a1...a6f5e4d3c2",
  "network": "testnet"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `report` | object | Yes | A `DiagnosticReport` object from the CLI or Core library |
| `tx_hash` | string | Yes | Transaction hash (used for cache keying and deduplication) |
| `network` | string | Yes | Network name |

**Response `200 OK`:**

```json
{
  "explanation": "Your contract ran out of CPU instructions because it iterates over a large collection without a bound check...",
  "suggested_fixes": [
    "Add a maximum iteration limit to the loop.",
    "Increase the CPU instruction budget in your transaction's resource declaration."
  ],
  "cached": false,
  "tokens_used": 312
}
```

**Response `400 Bad Request`:**

```json
{
  "error": "Missing required fields: report, tx_hash, network"
}
```

**Response `429 Too Many Requests` (hourly/daily budget exceeded):**

```json
{
  "error": "Hourly token budget exceeded",
  "hourly_remaining": 0,
  "daily_remaining": 48200,
  "reset_at": "2026-10-21T01:00:00.000Z"
}
```

**Response `429 Too Many Requests` (concurrency limit):**

```json
{
  "error": "Too many concurrent AI requests",
  "concurrent_active": 5,
  "concurrent_limit": 5
}
```

**Response `500 Internal Server Error`:**

```json
{
  "error": "AI provider returned an unexpected response"
}
```

**Example:**

```bash
curl -X POST http://localhost:3001/api/ai/explain \
  -H "Content-Type: application/json" \
  -d '{
    "report": { "error_name": "CPUExceeded", "severity": "Error", "summary": "..." },
    "tx_hash": "d5c3b2a1...",
    "network": "testnet"
  }'
```

---

### `GET /api/ai/budget`

Returns the current token usage and remaining budget for the active billing window.

**Request:** No body or headers required.

**Response `200 OK`:**

```json
{
  "hourly": {
    "used": 12400,
    "limit": 100000,
    "remaining": 87600,
    "reset_at": "2026-10-21T01:00:00.000Z"
  },
  "daily": {
    "used": 85000,
    "limit": 1000000,
    "remaining": 915000,
    "reset_at": "2026-10-22T00:00:00.000Z"
  },
  "concurrent_active": 1,
  "concurrent_limit": 5
}
```

**Example:**

```bash
curl http://localhost:3001/api/ai/budget
```

---

### `DELETE /api/ai/cache/:txHash`

Invalidates all cached AI explanations for a specific transaction hash. Useful after re-deploying a contract to force a fresh explanation.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `txHash` | string | Transaction hash whose cached responses should be purged |

**Response `200 OK`:**

```json
{
  "invalidated": 2,
  "tx_hash": "d5c3b2a1...a6f5e4d3c2"
}
```

**Example:**

```bash
curl -X DELETE http://localhost:3001/api/ai/cache/d5c3b2a1...
```

---

### `DELETE /api/ai/cache`

Clears the entire AI response cache.

**Response `200 OK`:**

```json
{
  "invalidated": 47
}
```

**Example:**

```bash
curl -X DELETE http://localhost:3001/api/ai/cache
```

---

## WebSocket Streaming

The Grat server (started via `grat serve`) exposes a WebSocket endpoint at `/ws` for streaming live trace events from the replay engine to the web frontend.

**Endpoint:** `ws://localhost:8080/ws`

> Note: The WebSocket server is provided by the **CLI's built-in `serve` command** (`grat serve`), not the Fastify server. The Fastify server (`apps/server`) handles the REST API and session management.

### Initiating a Stream

Send a JSON message after connecting:

```json
{
  "tx_hash": "d5c3b2a1...a6f5e4d3c2",
  "resume_from": null
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tx_hash` | string | Yes | Transaction to replay |
| `resume_from` | number\|null | No | Index of the last received trace node. Set to resume after a dropped connection. |

### Message Types

The server sends a stream of typed JSON messages:

#### `trace_started`

Emitted when the replay begins. Emitted a second time once the ledger sequence is known.

```json
{
  "type": "trace_started",
  "tx_hash": "d5c3b2a1...",
  "ledger_sequence": 12345
}
```

#### `trace_node`

One message per execution event (host function call, event emission, etc.).

```json
{
  "type": "trace_node",
  "node": {
    "kind": "HostFnCall",
    "name": "invoke_contract",
    "cpu": 1200,
    "memory": 4096
  },
  "path": [3]
}
```

#### `resource_update`

Emitted every 10 trace nodes with the current resource consumption totals.

```json
{
  "type": "resource_update",
  "trace_id": "trc_abc123",
  "cpu_used": 45230,
  "memory_used": 512048,
  "cpu_limit": 100000000,
  "memory_limit": 41943040
}
```

#### `state_diff_entry`

One message per ledger entry that changed during the replay.

```json
{
  "type": "state_diff_entry",
  "key": "Contract::Balance[GABC...XYZ]",
  "before": "1000",
  "after": "750",
  "change_type": "Updated"
}
```

#### `trace_completed`

Emitted when all trace nodes have been streamed.

```json
{
  "type": "trace_completed",
  "total_nodes": 48,
  "duration_ms": 1240
}
```

#### `trace_error`

Emitted if the replay fails at any point.

```json
{
  "type": "trace_error",
  "error": "Failed to reconstruct state: ledger not found in archive"
}
```

### JavaScript Example

```javascript
const ws = new WebSocket("ws://localhost:8080/ws");

ws.onopen = () => {
  ws.send(JSON.stringify({
    tx_hash: "d5c3b2a1...a6f5e4d3c2",
    resume_from: null,
  }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  switch (msg.type) {
    case "trace_started":
      console.log("Replay started at ledger", msg.ledger_sequence);
      break;
    case "trace_node":
      console.log("Node:", msg.node);
      break;
    case "trace_completed":
      console.log(`Done: ${msg.total_nodes} nodes in ${msg.duration_ms}ms`);
      break;
    case "trace_error":
      console.error("Replay error:", msg.error);
      break;
  }
};
```

---

## Server Configuration

The server is configured via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | HTTP server port |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL (session store) |
| `GRAT_BINARY` | `grat` | Path to the `grat` CLI binary |
| `AI_API_KEY` | *(required for AI endpoints)* | OpenAI-compatible API key |
| `AI_API_BASE_URL` | `https://api.openai.com/v1` | AI provider base URL |
| `AI_MODEL` | `gpt-4o-mini` | Model to use for AI explanations |
| `AI_MAX_TOKENS_PER_REQUEST` | `2048` | Maximum tokens per AI call |
| `AI_TEMPERATURE` | `0.2` | Sampling temperature |
| `AI_TIMEOUT_MS` | `30000` | Timeout for AI requests (ms) |
| `AI_HOURLY_TOKEN_LIMIT` | `100000` | Hourly token budget |
| `AI_DAILY_TOKEN_LIMIT` | `1000000` | Daily token budget |
| `AI_MAX_CONCURRENT` | `5` | Max simultaneous AI requests |
| `CACHE_DECODE_TTL` | `86400` | Cache TTL for decoded results (seconds) |
| `CACHE_PROFILE_TTL` | `3600` | Cache TTL for profiled results (seconds) |
| `DEDUP_WINDOW_MS` | `10000` | Deduplication window for identical requests (ms) |

---

## Quick Reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | — | Server health check |
| `POST` | `/api/replay` | — | Enqueue a replay job |
| `GET` | `/api/replay/:jobId` | — | Poll replay job status |
| `POST` | `/api/session` | — | Create a debug session |
| `GET` | `/api/session/:sessionId` | — | Get session metadata |
| `PATCH` | `/api/session/:sessionId/snapshot` | Bearer | Push a trace snapshot |
| `POST` | `/api/session/:sessionId/heartbeat` | Bearer | Keep session alive |
| `DELETE` | `/api/session/:sessionId` | Bearer | Delete a session |
| `POST` | `/api/ai/explain` | — | AI-explain a diagnostic report |
| `GET` | `/api/ai/budget` | — | Get current token budget usage |
| `DELETE` | `/api/ai/cache/:txHash` | — | Invalidate AI cache for a tx |
| `DELETE` | `/api/ai/cache` | — | Clear entire AI cache |
