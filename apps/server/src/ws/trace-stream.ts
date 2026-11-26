import { WebSocketServer, WebSocket } from "ws";
import { logger } from "../logger";

export interface TraceStreamMessage {
  type:
    | "trace_started"
    | "trace_node"
    | "resource_update"
    | "state_diff_entry"
    | "trace_completed"
    | "trace_error"
    | "session_expired";
  trace_id?: string;
  session_id?: string;
  [key: string]: any;
}

interface AuthenticatedWebSocket extends WebSocket {
  isAlive: boolean;
  missedPings: number;
  sessionId?: string;
}

export interface TraceStreamServer {
  wss: WebSocketServer;
  /**
   * Notify all clients subscribed to `sessionId` that the session has expired
   * and close their connections after the message is flushed.
   */
  notifySessionExpired(sessionId: string): void;
}

export function createTraceStream(port: number): TraceStreamServer {
  const wss = new WebSocketServer({ port });

  /** sessionId → set of subscribed clients */
  const subscriptions = new Map<string, Set<AuthenticatedWebSocket>>();

  function subscribe(ws: AuthenticatedWebSocket, sessionId: string): void {
    ws.sessionId = sessionId;
    if (!subscriptions.has(sessionId)) {
      subscriptions.set(sessionId, new Set());
    }
    subscriptions.get(sessionId)!.add(ws);
  }

  function unsubscribe(ws: AuthenticatedWebSocket): void {
    if (!ws.sessionId) return;
    const peers = subscriptions.get(ws.sessionId);
    if (peers) {
      peers.delete(ws);
      if (peers.size === 0) {
        subscriptions.delete(ws.sessionId);
      }
    }
  }

  wss.on("connection", (rawWs: WebSocket) => {
    const ws = rawWs as AuthenticatedWebSocket;
    ws.isAlive = true;
    ws.missedPings = 0;

    logger.info("New trace stream client connected");

    ws.on("message", (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === "subscribe" && message.session_id) {
          subscribe(ws, message.session_id);
          logger.info(`Client subscribed to session: ${message.session_id}`, {
            session_id: message.session_id,
          });
          ws.send(
            JSON.stringify({
              type: "subscribed",
              session_id: message.session_id,
            }),
          );
        } else if (message.type === "subscribe" && message.tx_hash) {
          // Legacy path: subscribe by tx_hash without a session context.
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
      unsubscribe(ws);
      logger.info("Trace stream client disconnected");
    });

    ws.on("error", (err) => {
      logger.error("WebSocket error", { error: String(err) });
    });
  });

  logger.info(`Trace stream WebSocket server listening on port ${port}`, { port });

  function notifySessionExpired(sessionId: string): void {
    const peers = subscriptions.get(sessionId);
    if (!peers || peers.size === 0) return;

    const payload = JSON.stringify({
      type: "session_expired",
      session_id: sessionId,
    });

    for (const ws of peers) {
      try {
        ws.send(payload, () => {
          // Close the connection after the message is flushed.
          ws.close(1001, "Session expired");
        });
      } catch (err) {
        logger.error("Failed to send session_expired notification", {
          session_id: sessionId,
          error: String(err),
        });
      }
    }

    subscriptions.delete(sessionId);
    logger.info("Notified clients of session expiry", { session_id: sessionId });
  }

  return { wss, notifySessionExpired };
}
