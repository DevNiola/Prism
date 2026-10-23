import { useState, useCallback, useRef } from "react";
import { useWebSocket, TraceStreamCallbacks } from "./useWebSocket";

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
  completed: boolean;
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
  /** Whether a cancel was requested */
  const cancelledRef = useRef(false);

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

      // Estimate remaining based on elapsed and progress so far
      let estimatedRemaining: number | null = null;
      if (percent > 0 && percent < 100 && elapsed > 0) {
        const totalEstimate = (elapsed / percent) * 100;
        estimatedRemaining = Math.max(
          0,
          Math.round(totalEstimate - elapsed)
        );
      }

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
      if (cancelledRef.current) return;
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
      if (cancelledRef.current) return;
      setTrace((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          nodes: [...prev.nodes, data],
        };
      });
      updatePhase("replaying");
    },
    onResourceUpdate: (data) => {
      if (cancelledRef.current) return;
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
      if (cancelledRef.current) return;
      setTrace((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          state_diff: [...prev.state_diff, data],
        };
      });
      updatePhase("decoding");
    },
    onTraceCompleted: (data) => {
      if (cancelledRef.current) return;
      setTrace((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          completed: true,
        };
      });
      stopTicker();
      updatePhase("complete");
      setLoading(false);
    },
    onTraceError: (data) => {
      if (cancelledRef.current) return;
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
  } = useWebSocket(wsUrl || "", callbacks);

  const requestTrace = useCallback(
    (txHash: string, network: string) => {
      cancelledRef.current = false;
      startTimeRef.current = Date.now();

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
          const estimatedRemaining =
            prev.percent > 0 && prev.percent < 100
              ? Math.max(
                  0,
                  Math.round((elapsed / prev.percent) * 100 - elapsed)
                )
              : null;
          return { ...prev, elapsed, estimatedRemaining };
        });
      }, 1000);

      if (wsUrl && connected) {
        wsRequestTrace(txHash);
        updatePhase("fetching");
      } else {
        // Simulate progress phases for non-streaming mode
        setLoading(true);
        updatePhase("fetching");
        const phases: TracePhase[] = [
          "fetching",
          "decoding",
          "replaying",
          "profiling",
        ];
        let i = 0;
        const advance = () => {
          if (cancelledRef.current) return;
          if (i < phases.length) {
            updatePhase(phases[i]);
            i++;
            setTimeout(advance, 800);
          } else {
            stopTicker();
            updatePhase("complete");
            setLoading(false);
          }
        };
        setTimeout(advance, 400);
      }
    },
    [wsUrl, connected, wsRequestTrace, updatePhase, stopTicker]
  );

  const cancelTrace = useCallback(() => {
    cancelledRef.current = true;
    stopTicker();
    setLoading(false);
    setProgress({
      phase: "cancelled",
      percent: 0,
      label: PHASE_LABELS.cancelled,
      elapsed: 0,
      estimatedRemaining: null,
    });
  }, [stopTicker]);

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
