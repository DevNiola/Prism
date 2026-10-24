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

export function createTraceStream(port: number) {
  const wss = new WebSocketServer({ port });

  wss.on("connection", (ws: WebSocket) => {
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
      logger.info("Trace stream client disconnected");
    });

    ws.on("error", (err) => {
      logger.error("WebSocket error", { error: String(err) });
    });
  });

  logger.info(`Trace stream WebSocket server listening on port ${port}`, { port });
  return wss;
}
