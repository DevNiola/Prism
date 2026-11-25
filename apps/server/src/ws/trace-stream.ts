import { WebSocketServer, WebSocket } from "ws";
import { logger } from "../logger";

export interface TraceStreamMessage {
  type:
    | "trace_started"
    | "trace_node"
    | "resource_update"
    | "state_diff_entry"
    | "trace_completed"
    | "trace_error";
  trace_id?: string;
  [key: string]: any;
}

interface AuthenticatedWebSocket extends WebSocket {
  isAlive: boolean;
  missedPings: number;
  sessionId?: string;
}

let wss: WebSocketServer | null = null;
const activeConnections = new Set<WebSocket>();

export function createTraceStream(port: number) {
  wss = new WebSocketServer({ port });

  wss.on("connection", (ws: WebSocket) => {
    activeConnections.add(ws);
    logger.info("New trace stream client connected");

    ws.on("message", (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === "subscribe" && message.tx_hash) {
          logger.info(`Client subscribed to trace: ${message.tx_hash}`, {
            tx_hash: message.tx_hash,
          });

          ws.send(
            JSON.stringify({
              type: "subscribed",
              tx_hash: message.tx_hash,
            }),
          );
        }
      } catch (err) {
        logger.error("Failed to parse WebSocket message", { error: String(err) });
      }
    });

    ws.on("close", () => {
      activeConnections.delete(ws);
      logger.info("Trace stream client disconnected");
    });

    ws.on("error", (err) => {
      logger.error("WebSocket error", { error: String(err) });
    });
  });

  logger.info(`Trace stream WebSocket server listening on port ${port}`, { port });
  return wss;
}

/**
 * Gracefully shuts down the trace-stream WebSocket server:
 * 1. Broadcasts a server_shutdown message to all open clients.
 * 2. Calls wss.close() to stop accepting new connections.
 * 3. Waits drainMs for clients to close voluntarily.
 * 4. Force-terminates any remaining open connections.
 */
export async function shutdownTraceStream(drainMs: number = 500): Promise<void> {
  if (!wss) {
    return;
  }

  const shutdownMessage = JSON.stringify({
    type: "trace_error",
    reason: "server_shutdown",
    message: "Server is shutting down",
  });

  for (const ws of activeConnections) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(shutdownMessage);
      } catch (err) {
        logger.warn("Failed to send shutdown message to client", { error: String(err) });
      }
    }
  }

  await new Promise<void>((resolve) => {
    wss!.close(() => resolve());
  });

  await new Promise<void>((resolve) => setTimeout(resolve, drainMs));

  for (const ws of activeConnections) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.terminate();
    }
  }

  activeConnections.clear();
  logger.info("Trace stream WebSocket server shut down");
}
