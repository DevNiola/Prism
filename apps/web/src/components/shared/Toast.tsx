"use client";

import { useEffect, useRef, useState } from "react";
import {
  useToasts,
  dismiss,
  type ToastItem,
  type ToastType,
} from "@/hooks/useToast";

const TYPE_STYLES: Record<ToastType, { accent: string; icon: string }> = {
  success: { accent: "text-success", icon: "✓" },
  error: { accent: "text-destructive", icon: "⚠" },
  warning: { accent: "text-warning", icon: "⚠" },
  info: { accent: "text-info", icon: "ℹ" },
};

function ToastEntry({ toast: t }: { toast: ToastItem }) {
  const [remaining, setRemaining] = useState(t.duration);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  // Mutable remaining time so the rAF loop avoids stale-state reads.
  const remainingRef = useRef(t.duration);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number>(0);

  const paused = hovered || focused;
  const sticky = t.duration <= 0;

  // Countdown driver: only runs while not paused and not sticky. Pausing
  // (hover/focus) tears the loop down; resuming recreates it without a jump
  // because `lastRef` is reset on each run.
  useEffect(() => {
    if (sticky || paused) return;

    lastRef.current = performance.now();

    function tick(now: number) {
      const delta = now - lastRef.current;
      lastRef.current = now;
      remainingRef.current -= delta;
      const next = Math.max(0, remainingRef.current);
      setRemaining(next);
      if (next <= 0) {
        dismiss(t.id);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [paused, sticky, t.id]);

  function handleUndo() {
    t.undo?.run();
    dismiss(t.id);
  }

  const style = TYPE_STYLES[t.type];
  const progressPct = sticky ? 100 : (remaining / t.duration) * 100;
  const role = t.type === "error" || t.type === "warning" ? "alert" : "status";

  return (
    <div
      role={role}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={() => setFocused(false)}
      className="card-interactive relative w-80 overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-xl"
    >
      <div className="flex items-start gap-3 p-3 pr-2">
        <span className={`mt-0.5 text-sm ${style.accent}`} aria-hidden="true">
          {style.icon}
        </span>
        <p className="flex-1 text-sm leading-snug pt-0.5">{t.message}</p>

        {t.undo && (
          <button
            type="button"
            onClick={handleUndo}
            className="btn-press shrink-0 rounded px-2 py-1 text-xs font-semibold text-primary hover:bg-muted transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {t.undo.label}
          </button>
        )}

        <button
          type="button"
          onClick={() => dismiss(t.id)}
          aria-label="Dismiss notification"
          className="btn-press shrink-0 rounded p-1 text-muted-foreground hover:text-card-foreground hover:bg-muted transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          ✕
        </button>
      </div>

      {/* Auto-dismiss progress bar (hidden for sticky toasts) */}
      {!sticky && (
        <div
          className="h-0.5 w-full bg-muted"
          role="progressbar"
          aria-valuenow={Math.round(progressPct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Time until this notification dismisses"
        >
          <div
            className={`h-full transition-[width] duration-75 ease-linear ${style.accent} bg-current`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** Mounted once in the root layout; renders the live toast stack. */
export default function ToastContainer() {
  const toasts = useToasts();

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2"
      aria-label="Notifications"
      // aria-live announces new toasts to assistive tech without moving focus.
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((t) => (
        // pointer-events-auto so the interactive toasts stay clickable.
        <div key={t.id} className="pointer-events-auto">
          <ToastEntry toast={t} />
        </div>
      ))}
    </div>
  );
}
