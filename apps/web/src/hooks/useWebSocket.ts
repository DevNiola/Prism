import { useEffect, useRef, useState, useCallback } from "react";

export interface TraceNode {
  node: any;
  path: number[];
}

export interface ResourceUpdate {
  cpu_used: number;
  memory_used: number;
  cpu_limit: number;
  memory_limit: number;
  read_bytes: number;
  read_limit: number;
  write_bytes: number;
  write_limit: number;
}

export interface StateDiffEntry {
  key: string;
  before?: string;
  after?: string;
  change_type: string;
}

export interface TraceStreamCallbacks {
  onTraceStarted?: (data: { tx_hash: string; ledger_sequence: number }) => void;
  onTraceNode?: (data: TraceNode) => void;
  onResourceUpdate?: (data: ResourceUpdate) => void;
  onStateDiffEntry?: (data: StateDiffEntry) => void;
  onTraceCompleted?: (data: {
    total_nodes: number;
    duration_ms: number;
  }) => void;
  onTraceError?: (data: { error: string }) => void;
}

export type WebSocketStatus = "connecting" | "open" | "reconnecting" | "closed";

const INITIAL_DELAY_MS = 500;
const MAX_DELAY_MS = 8000;

export function useWebSocket(
  url: string,
  callbacks?: TraceStreamCallbacks,
  { maxAttempts = 5 }: { maxAttempts?: number } = {},
) {
  const wsRef = useRef<WebSocket | null>(null);
  const callbacksRef = useRef(callbacks);
  const cancelRef = useRef<(() => void) | null>(null);
  const connectRef = useRef<(() => void) | null>(null);
  const pendingTrace = useRef<{ tx_hash: string; resume_from?: number } | null>(null);
  const [status, setStatus] = useState<WebSocketStatus>(url ? "connecting" : "closed");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  useEffect(() => {
    setError(null);
    if (!url) {
      setStatus("closed");
      return;
    }

    let attempts = 0;
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      timer = undefined;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        pendingTrace.current = null;
        setError("Invalid WebSocket URL");
        setStatus("closed");
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("open");
        setError(null);
        if (pendingTrace.current) ws.send(JSON.stringify(pendingTrace.current));
      };

      ws.onmessage = (event) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        try {
          const message = JSON.parse(event.data);
          const handlers = callbacksRef.current;
          switch (message.type) {
            case "trace_started":
              handlers?.onTraceStarted?.(message);
              break;
            case "trace_node":
              if (pendingTrace.current && message.path?.length === 1 && Number.isSafeInteger(message.path[0])) {
                pendingTrace.current.resume_from = message.path[0];
              }
              handlers?.onTraceNode?.(message);
              break;
            case "resource_update":
              handlers?.onResourceUpdate?.(message);
              break;
            case "state_diff_entry":
              handlers?.onStateDiffEntry?.(message);
              break;
            case "trace_completed":
              pendingTrace.current = null;
              finished = true;
              attempts = 0;
              handlers?.onTraceCompleted?.(message);
              break;
            case "trace_error":
              pendingTrace.current = null;
              finished = true;
              attempts = 0;
              handlers?.onTraceError?.(message);
              setError(message.error);
              break;
          }
        } catch (err) {
          console.error("Failed to handle WebSocket message:", err);
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (finished || attempts >= maxAttempts) {
          if (!finished) setError("Trace connection closed. Try starting the replay again.");
          pendingTrace.current = null;
          setStatus("closed");
          return;
        }
        const delay = Math.min(INITIAL_DELAY_MS * 2 ** attempts, MAX_DELAY_MS);
        attempts += 1;
        setStatus("reconnecting");
        timer = setTimeout(connect, delay);
      };
    }

    connectRef.current = () => {
      finished = false;
      attempts = 0;
      if (timer !== undefined || wsRef.current) return;
      setError(null);
      setStatus("connecting");
      connect();
    };

    cancelRef.current = () => {
      finished = true;
      clearTimeout(timer);
      timer = undefined;
      pendingTrace.current = null;
      setStatus("closed");
      // Discard remaining updates before accepting another replay.
      wsRef.current?.close();
    };

    setStatus("connecting");
    connect();

    return () => {
      clearTimeout(timer);
      connectRef.current = null;
      cancelRef.current = null;
      pendingTrace.current = null;
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onopen = ws.onmessage = ws.onclose = null;
        ws.close();
      }
    };
  }, [url, maxAttempts]);

  const sendMessage = useCallback((message: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn("WebSocket is not connected");
    }
  }, []);

  const requestTrace = useCallback((txHash: string) => {
    pendingTrace.current = { tx_hash: txHash };
    connectRef.current?.();
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      setError(null);
      sendMessage(pendingTrace.current);
    }
  }, [sendMessage]);

  const cancelRequest = useCallback(() => cancelRef.current?.(), []);

  return { connected: status === "open", status, error, sendMessage, requestTrace, cancelRequest };
}
