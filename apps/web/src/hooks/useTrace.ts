import { useState, useCallback, useEffect, useRef } from "react";
import { useWebSocket, type TraceStreamCallbacks } from "./useWebSocket";
import { useSessionStore } from "@/store/session";

import type { DiagnosticEventEntry } from "@/lib/types";

import type { DiagnosticEventEntry } from "@/lib/types";

export type TracePhase =
  | "idle"
  | "fetching"
  | "decoding"
  | "replaying"
  | "profiling"
  | "complete"
  | "error"
  | "cancelled";

export interface TraceProgress {
  phase: TracePhase;
  /** 0–100 */
  percent: number;
  /** Human-readable phase label */
  label: string;
  /** Elapsed seconds since trace started */
  elapsed: number;
  /** Estimated seconds remaining (null when unknown) */
  estimatedRemaining: number | null;
}

export interface TraceData {
  tx_hash: string;
  ledger_sequence: number;
  nodes: any[];
  resource_profile?: {
    cpu_used: number;
    memory_used: number;
    cpu_limit: number;
    memory_limit: number;
    read_bytes: number;
    read_limit: number;
    write_bytes: number;
    write_limit: number;
  };
  state_diff: any[];
  diagnostic_events?: DiagnosticEventEntry[];
  completed: boolean;
  diagnostic_events?: DiagnosticEventEntry[];
  error?: string;
}

const PHASE_LABELS: Record<TracePhase, string> = {
  idle: "Idle",
  fetching: "Fetching transaction data…",
  decoding: "Decoding error codes…",
  replaying: "Replaying execution…",
  profiling: "Profiling resources…",
  complete: "Complete",
  error: "Error",
  cancelled: "Cancelled",
};

/** Approximate percent-complete for each phase */
const PHASE_PERCENT: Record<TracePhase, number> = {
  idle: 0,
  fetching: 15,
  decoding: 35,
  replaying: 70,
  profiling: 90,
  complete: 100,
  error: 100,
  cancelled: 0,
};

export function useTrace(wsUrl?: string) {
  const [trace, setTrace] = useState<TraceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<TraceProgress>({
    phase: "idle",
    percent: 0,
    label: PHASE_LABELS.idle,
    elapsed: 0,
    estimatedRemaining: null,
  });

  /** Ref to track start time for elapsed/estimated calculations */
  const startTimeRef = useRef<number | null>(null);
  /** Interval ref for the elapsed-time ticker */
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeHash = useRef<string | null>(null);
  const cadence = useRef({ total: 0, received: 0, firstAt: 0 });
  const estimateEndsAt = useRef<number | null>(null);
  const simulationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTicker = useCallback(() => {
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
  }, []);

  const updatePhase = useCallback(
    (phase: TracePhase) => {
      const percent = PHASE_PERCENT[phase];
      const now = Date.now();
      const elapsed = startTimeRef.current
        ? Math.round((now - startTimeRef.current) / 1000)
        : 0;

      const estimatedRemaining = phase === "replaying" && estimateEndsAt.current !== null
        ? Math.max(1, Math.ceil((estimateEndsAt.current - now) / 1000))
        : null;

      setProgress({
        phase,
        percent,
        label: PHASE_LABELS[phase],
        elapsed,
        estimatedRemaining,
      });
    },
    []
  );

  const callbacks: TraceStreamCallbacks = {
    onTraceStarted: (data) => {
      if (activeHash.current !== data.tx_hash) return;
      cadence.current.total = data.total_nodes ?? 0;
      setTrace({
        tx_hash: data.tx_hash,
        ledger_sequence: data.ledger_sequence,
        nodes: [],
        state_diff: [],
        completed: false,
      });
      setLoading(true);
      updatePhase("fetching");
    },
    onTraceNode: (data) => {
      if (!activeHash.current) return;
      setTrace((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          nodes: [...prev.nodes, data],
        };
      });
      const sample = cadence.current;
      const now = Date.now();
      sample.received++;
      if (sample.received === 1) sample.firstAt = now;
      if (sample.received > 1 && sample.total > sample.received && now > sample.firstAt) {
        const averageInterval = (now - sample.firstAt) / (sample.received - 1);
        estimateEndsAt.current = now + averageInterval * (sample.total - sample.received);
      } else {
        estimateEndsAt.current = null;
      }
      updatePhase("replaying");
    },
    onResourceUpdate: (data) => {
      if (!activeHash.current) return;
      setTrace((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          resource_profile: data,
        };
      });
      updatePhase("profiling");
    },
    onStateDiffEntry: (data) => {
      if (!activeHash.current) return;
      setTrace((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          state_diff: [...prev.state_diff, data],
        };
      });
      updatePhase("decoding");
    },
    onTraceCompleted: () => {
      if (!activeHash.current) return;
      activeHash.current = null;
      setTrace((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          completed: true,
          diagnostic_events: data.diagnostic_events,
        };
      });
      stopTicker();
      updatePhase("complete");
      setLoading(false);
    },
    onTraceError: (data) => {
      if (!activeHash.current) return;
      activeHash.current = null;
      setTrace((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          error: data.error,
          completed: true,
        };
      });
      stopTicker();
      updatePhase("error");
      setLoading(false);
    },
  };

  const {
    connected,
    error: wsError,
    requestTrace: wsRequestTrace,
    close: closeSocket,
  } = useWebSocket(wsUrl || "", callbacks);

  const requestTrace = useCallback(
    (txHash: string) => {
      if (activeHash.current) return;
      activeHash.current = txHash;
      cadence.current = { total: 0, received: 0, firstAt: 0 };
      estimateEndsAt.current = null;
      setTrace(null);
      setLoading(true);
      startTimeRef.current = Date.now();
      updatePhase("fetching");

      // Start elapsed ticker
      stopTicker();
      tickerRef.current = setInterval(() => {
        if (!startTimeRef.current) return;
        const elapsed = Math.round(
          (Date.now() - startTimeRef.current) / 1000
        );
        setProgress((prev) => {
          if (
            prev.phase === "complete" ||
            prev.phase === "error" ||
            prev.phase === "cancelled" ||
            prev.phase === "idle"
          ) {
            return prev;
          }
          const estimatedRemaining = prev.phase === "replaying" && estimateEndsAt.current !== null
            ? Math.max(1, Math.ceil((estimateEndsAt.current - Date.now()) / 1000))
            : null;
          return { ...prev, elapsed, estimatedRemaining };
        });
      }, 1000);

      if (wsUrl) {
        wsRequestTrace(txHash);
      } else {
        // Simulate progress phases for non-streaming mode
        const phases: TracePhase[] = [
          "fetching",
          "decoding",
          "replaying",
          "profiling",
        ];
        let i = 0;
        const advance = () => {
          if (!activeHash.current) return;
          if (i < phases.length) {
            updatePhase(phases[i]);
            i++;
            simulationTimer.current = setTimeout(advance, 800);
          } else {
            activeHash.current = null;
            stopTicker();
            updatePhase("complete");
            setLoading(false);
          }
        };
        simulationTimer.current = setTimeout(advance, 400);
      }
    },
    [wsUrl, wsRequestTrace, updatePhase, stopTicker]
  );

  const cancelTrace = useCallback(() => {
    const txHash = activeHash.current;
    if (!txHash) return;
    activeHash.current = null;
    useSessionStore.getState().recordReplayCancel(txHash);
    closeSocket();
    if (simulationTimer.current !== null) clearTimeout(simulationTimer.current);
    stopTicker();
    setLoading(false);
    updatePhase("cancelled");
  }, [closeSocket, stopTicker, updatePhase]);

  useEffect(() => () => {
    activeHash.current = null;
    stopTicker();
    if (simulationTimer.current !== null) clearTimeout(simulationTimer.current);
  }, [wsUrl, stopTicker]);

  return {
    trace,
    loading,
    progress,
    requestTrace,
    cancelTrace,
    streaming: !!wsUrl && connected,
    streamError: wsError,
  };
}
