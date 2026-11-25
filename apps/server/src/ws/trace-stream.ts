import { WebSocketServer, WebSocket } from "ws";

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export interface TraceStreamMessage {
  type:
    | "trace_started"
    | "trace_node"
    | "resource_update"
    | "state_diff_entry"
    | "trace_completed"
    | "trace_error";
  trace_id?: string;
  [key: string]: unknown;
}

export interface TraceErrorMessage extends TraceStreamMessage {
  type: "trace_error";
  trace_id: string;
  reason: "cancelled" | "timeout" | "error";
  message?: string;
}

// ---------------------------------------------------------------------------
// Per-trace subscriber registry
//
// Maps a trace_id (typically the job ID) to the set of WebSocket clients
// currently subscribed to it.  Used to broadcast events from the worker.
// ---------------------------------------------------------------------------
const subscribers = new Map<string, Set<WebSocket>>();

function addSubscriber(traceId: string, ws: WebSocket): void {
  if (!subscribers.has(traceId)) subscribers.set(traceId, new Set());
  subscribers.get(traceId)!.add(ws);
}

function removeSubscriber(traceId: string, ws: WebSocket): void {
  const set = subscribers.get(traceId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) subscribers.delete(traceId);
}

// ---------------------------------------------------------------------------
// Broadcast helpers (called by the worker or route handlers)
// ---------------------------------------------------------------------------

/**
 * Broadcast an arbitrary message to all clients subscribed to `traceId`.
 */
export function broadcast(traceId: string, message: TraceStreamMessage): void {
  const set = subscribers.get(traceId);
  if (!set || set.size === 0) return;
  const payload = JSON.stringify(message);
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

/**
 * Emit a `trace_error` event to every subscriber of `traceId`.
 *
 * Called by the replay worker when a job is cancelled or times out so that
 * connected clients stop waiting and surface the right error state.
 */
export function broadcastCancelled(
  traceId: string,
  reason: TraceErrorMessage["reason"] = "cancelled",
  message?: string,
): void {
  broadcast(traceId, {
    type: "trace_error",
    trace_id: traceId,
    reason,
    ...(message ? { message } : {}),
  });
}

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------

export function createTraceStream(port: number) {
  const wss = new WebSocketServer({ port });

  wss.on("connection", (ws: WebSocket) => {
    console.log("New trace stream client connected");

    // Track which trace IDs this socket has subscribed to so we can clean up
    // on disconnect.
    const subscribed = new Set<string>();

    ws.on("message", (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;

        if (message["type"] === "subscribe" && typeof message["tx_hash"] === "string") {
          const traceId = message["tx_hash"];
          console.log(`Client subscribed to trace: ${traceId}`);
          addSubscriber(traceId, ws);
          subscribed.add(traceId);

          ws.send(
            JSON.stringify({
              type: "subscribed",
              tx_hash: traceId,
            }),
          );
        }

        if (message["type"] === "unsubscribe" && typeof message["tx_hash"] === "string") {
          const traceId = message["tx_hash"];
          removeSubscriber(traceId, ws);
          subscribed.delete(traceId);
        }
      } catch (err) {
        console.error("Failed to parse WebSocket message:", err);
      }
    });

    ws.on("close", () => {
      console.log("Trace stream client disconnected");
      for (const traceId of subscribed) {
        removeSubscriber(traceId, ws);
      }
    });

    ws.on("error", (err) => {
      console.error("WebSocket error:", err);
    });
  });

  console.log(`Trace stream WebSocket server listening on port ${port}`);
  return wss;
}
