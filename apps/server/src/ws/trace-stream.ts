import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { verifySessionToken } from "../middleware";
import { config } from "../config";
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

export function createTraceStream(port: number) {
  const wss = new WebSocketServer({ port });

  // -------------------------------------------------------------------------
  // Heartbeat Interval: Ping every 15s; terminate dead connections at 30s.
  // -------------------------------------------------------------------------
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((client) => {
      const ws = client as AuthenticatedWebSocket;
      if (ws.isAlive === false) {
        ws.missedPings = (ws.missedPings || 0) + 1;
        // Two consecutive missed pings (30s) -> dead connection
        if (ws.missedPings >= 2) {
          logger.warn("Closing inactive WebSocket connection (30s timeout exceeded)", {
            sessionId: ws.sessionId,
          });
          return ws.terminate();
        }
      }

      ws.isAlive = false;
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    });
  }, 15_000);

  wss.on("close", () => {
    clearInterval(heartbeatInterval);
  });

  // -------------------------------------------------------------------------
  // Connection Handler with Authentication
  // -------------------------------------------------------------------------
  wss.on("connection", (wsClient: WebSocket, req: IncomingMessage) => {
    const ws = wsClient as AuthenticatedWebSocket;
    ws.isAlive = true;
    ws.missedPings = 0;

    // 1. Authenticate connection
    let token: string | null = null;
    try {
      const parsedUrl = new URL(req.url || "", "http://localhost");
      token =
        parsedUrl.searchParams.get("token") ||
        (req.headers["sec-websocket-protocol"] as string) ||
        null;

      if (!token && req.headers.authorization?.startsWith("Bearer ")) {
        token = req.headers.authorization.substring(7);
      }
    } catch {
      token = null;
    }

    if (!config.disableSessionAuth) {
      if (!token) {
        logger.warn("Rejected unauthenticated WebSocket connection: missing token");
        ws.close(4001, "Unauthorized: Valid session token required");
        return;
      }

      const payload = verifySessionToken(token, config.jwtSecret);
      if (!payload) {
        logger.warn("Rejected unauthenticated WebSocket connection: invalid/expired token");
        ws.close(4001, "Unauthorized: Invalid or expired token");
        return;
      }

      ws.sessionId = payload.sessionId;
    }

    logger.info("Trace stream client connected and authenticated", {
      sessionId: ws.sessionId,
    });

    ws.on("pong", () => {
      ws.isAlive = true;
      ws.missedPings = 0;
    });

    ws.on("message", (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === "subscribe" && message.tx_hash) {
          logger.info(`Client subscribed to trace: ${message.tx_hash}`, {
            sessionId: ws.sessionId,
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
        logger.error("Failed to parse WebSocket message", {
          sessionId: ws.sessionId,
          error: String(err),
        });
      }
    });

    ws.on("close", () => {
      logger.info("Trace stream client disconnected", {
        sessionId: ws.sessionId,
      });
    });

    ws.on("error", (err) => {
      logger.error("WebSocket client error", {
        sessionId: ws.sessionId,
        error: String(err),
      });
    });
  });

  logger.info(`Trace stream WebSocket server listening on port ${port}`, { port });
  return wss;
}
