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
  onTraceStarted?: (data: { tx_hash: string; ledger_sequence: number; total_nodes?: number }) => void;
  onTraceNode?: (data: TraceNode) => void;
  onResourceUpdate?: (data: ResourceUpdate) => void;
  onStateDiffEntry?: (data: StateDiffEntry) => void;
  onTraceCompleted?: (data: {
    total_nodes: number;
    duration_ms: number;
  }) => void;
  onTraceError?: (data: { error: string }) => void;
}

export function useWebSocket(url: string, callbacks?: TraceStreamCallbacks) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  const close = useCallback(() => {
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) ws.close();
    setConnected(false);
  }, []);

  const connect = useCallback(() => {
    if (!url) return null;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      setConnected(true);
      setError(null);
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;
      try {
        const callbacks = callbacksRef.current;
        const message = JSON.parse(event.data);

        switch (message.type) {
          case "subscribed":
            break;
          case "trace_started":
            callbacks?.onTraceStarted?.(message);
            break;
          case "trace_node":
            callbacks?.onTraceNode?.(message);
            break;
          case "resource_update":
            callbacks?.onResourceUpdate?.(message);
            break;
          case "state_diff_entry":
            callbacks?.onStateDiffEntry?.(message);
            break;
          case "trace_completed":
            callbacks?.onTraceCompleted?.(message);
            break;
          case "trace_error":
            callbacks?.onTraceError?.(message);
            setError(message.error);
            break;
          default:
            console.warn("Unknown message type:", message.type);
        }
      } catch (err) {
        console.error("Failed to parse WebSocket message:", err);
      }
    };

    ws.onerror = (event) => {
      if (wsRef.current !== ws) return;
      console.error("WebSocket error:", event);
      setError("WebSocket connection error");
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      callbacksRef.current?.onTraceError?.({ error: "Trace connection closed." });
      setConnected(false);
    };

    return ws;
  }, [url]);

  useEffect(() => {
    connect();
    return close;
  }, [connect, close]);

  const sendMessage = useCallback((message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn("WebSocket is not connected");
    }
  }, []);

  const requestTrace = useCallback(
    (txHash: string) => {
      const ws = wsRef.current ?? connect();
      const message = JSON.stringify({ type: "subscribe", tx_hash: txHash });
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(message);
      } else if (ws?.readyState === WebSocket.CONNECTING) {
        ws.addEventListener("open", () => {
          if (wsRef.current === ws) ws.send(message);
        }, { once: true });
      }
    },
    [connect],
  );

  return {
    connected,
    error,
    sendMessage,
    requestTrace,
    close,
  };
}
