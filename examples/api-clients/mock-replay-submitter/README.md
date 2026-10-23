# Mock Replay Submitter

This example shows how an external script or CI/CD pipeline can interact with
the Prism server REST API to submit a transaction hash for simulation/replay
and poll for the job's completion status.

## What it demonstrates

- Submitting a `POST /api/replay` request with a transaction hash.
- Receiving a job token and using it to poll `GET /api/replay/:token` until the
  job reaches a terminal state (`completed` or `failed`).
- Handling network errors and non-200 HTTP responses gracefully.
- Printing the final diagnostic report returned by the server.

## Prerequisites

- The Prism server must be running:
  ```bash
  pnpm --filter prism-server dev
  ```
- Node.js 18 or higher (uses the native `fetch` API; no polyfill needed).

## Installation

No external npm dependencies are required.

## Running the Example

Provide a real or mock transaction hash:

```bash
npm start <transaction_hash>
```

### Example

```bash
npm start a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
```

The script connects to `http://localhost:3001` by default.  Override with the
`API_URL` environment variable:

```bash
API_URL=http://my-host:3001 npm start <tx_hash>
```

## How it works

1. `submitReplayJob(txHash)` sends `POST /api/replay` and returns the job token.
2. `pollJobStatus(token)` calls `GET /api/replay/<token>` on a 1-second interval
   until the status is `completed` or `failed` (or a timeout is reached).
3. On `completed`, the full diagnostic report is printed to stdout as formatted
   JSON.
4. On `failed`, the error details are printed and the process exits with status 1.
