"use client";

import type { TracePhase, TraceProgress } from "@/hooks/useTrace";

interface ReplayProgressBarProps {
  progress: TraceProgress;
  onCancel: () => void;
}

const PHASES: { key: TracePhase; label: string; icon: string }[] = [
  { key: "fetching", label: "Fetching", icon: "⬇️" },
  { key: "decoding", label: "Decoding", icon: "🔍" },
  { key: "replaying", label: "Replaying", icon: "▶️" },
  { key: "profiling", label: "Profiling", icon: "📊" },
];

const PHASE_ORDER: TracePhase[] = [
  "fetching",
  "decoding",
  "replaying",
  "profiling",
  "complete",
];

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export function ReplayProgressBar({
  progress,
  onCancel,
}: ReplayProgressBarProps) {
  if (
    progress.phase === "idle" ||
    progress.phase === "cancelled"
  ) {
    return null;
  }

  const currentPhaseIndex = PHASE_ORDER.indexOf(progress.phase);
  const isActive = progress.phase !== "complete" && progress.phase !== "error";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Replay progress: ${progress.label}`}
      className="w-full rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-4"
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {isActive && (
            <span
              className="inline-block w-2 h-2 rounded-full bg-violet-500 animate-pulse"
              aria-hidden="true"
            />
          )}
          {progress.phase === "complete" && (
            <span className="text-green-400" aria-hidden="true">
              ✓
            </span>
          )}
          {progress.phase === "error" && (
            <span className="text-red-400" aria-hidden="true">
              ✗
            </span>
          )}
          <span
            className={`text-sm font-medium ${
              progress.phase === "complete"
                ? "text-green-400"
                : progress.phase === "error"
                  ? "text-red-400"
                  : "text-slate-200"
            }`}
          >
            {progress.label}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Timing info */}
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Elapsed: {formatTime(progress.elapsed)}</span>
            {progress.estimatedRemaining !== null && isActive && (
              <span>· ~{formatTime(progress.estimatedRemaining)} left</span>
            )}
          </div>

          {/* Cancel button */}
          {isActive && (
            <button
              type="button"
              onClick={onCancel}
              className="text-xs px-3 py-1.5 rounded-lg border border-slate-600 text-slate-400 hover:text-red-400 hover:border-red-500/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              aria-label="Cancel replay"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div
        className="w-full bg-slate-800 rounded-full h-2 overflow-hidden"
        role="progressbar"
        aria-valuenow={progress.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Replay completion percentage"
      >
        <div
          className={`h-2 rounded-full transition-all duration-700 ease-in-out ${
            progress.phase === "complete"
              ? "bg-green-500"
              : progress.phase === "error"
                ? "bg-red-500"
                : "bg-violet-500"
          }`}
          style={{ width: `${progress.percent}%` }}
        />
      </div>

      {/* Phase steps */}
      <div
        className="flex items-center gap-1"
        role="list"
        aria-label="Replay phases"
      >
        {PHASES.map(({ key, label, icon }, index) => {
          const phaseIndex = PHASE_ORDER.indexOf(key);
          const isDone = currentPhaseIndex > phaseIndex;
          const isCurrent =
            progress.phase === key ||
            (progress.phase === "complete" && phaseIndex === PHASES.length - 1);
          const isPending = !isDone && !isCurrent;

          return (
            <div
              key={key}
              role="listitem"
              className="flex-1 flex flex-col items-center gap-1"
              aria-current={isCurrent ? "step" : undefined}
            >
              <div
                className={`w-full h-1 rounded-full transition-all duration-500 ${
                  isDone || progress.phase === "complete"
                    ? "bg-green-500"
                    : isCurrent
                      ? "bg-violet-500"
                      : "bg-slate-700"
                }`}
              />
              <span
                className={`text-xs transition-colors ${
                  isDone || progress.phase === "complete"
                    ? "text-green-400"
                    : isCurrent
                      ? "text-violet-300"
                      : "text-slate-600"
                }`}
              >
                <span aria-hidden="true">{icon} </span>
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ReplayProgressBar;
