"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "prism_onboarding_completed";
const REPLAY_STORAGE_KEY = "prism_onboarding_replay";

interface TourStep {
  id: string;
  title: string;
  description: string;
  icon: string;
  /** CSS selector for the element to highlight */
  target?: string;
  position?: "top" | "bottom" | "left" | "right";
}

const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to Prism 🔬",
    description:
      "Prism helps you debug Soroban smart contract errors instantly. Decode cryptic error codes, replay transactions step-by-step, and profile resource usage — all in one place.",
    icon: "🔬",
  },
  {
    id: "decode",
    title: "Decode Errors",
    description:
      'Use the Decode page to transform raw Soroban error codes into plain English explanations with suggested fixes. Enter an error category and code, then click "Diagnose Error".',
    icon: "🔍",
    target: '[data-tour="decode-input"]',
  },
  {
    id: "network",
    title: "Network Switcher",
    description:
      "Switch between Testnet, Mainnet, and Futurenet using the network selector. Make sure you're connected to the right network before tracing a transaction.",
    icon: "🌐",
    target: '[data-tour="network-switcher"]',
  },
  {
    id: "trace",
    title: "Execution Trace",
    description:
      "Head to the Trace tab to replay any transaction step-by-step against historical ledger state. You'll see every host function call, resource usage, and state change.",
    icon: "▶️",
    target: '[data-tour="trace-tab"]',
  },
  {
    id: "debug",
    title: "Debug Tools",
    description:
      "The Debug tab gives you breakpoints, step-through execution, state inspection, and what-if re-simulation to pinpoint exactly what went wrong.",
    icon: "🐛",
    target: '[data-tour="debug-tab"]',
  },
];

interface OnboardingTourProps {
  /** Called when the user completes or skips the tour */
  onDone?: () => void;
}

export function OnboardingTour({ onDone }: OnboardingTourProps) {
  const [visible, setVisible] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    // Show tour on first visit OR when manually replayed
    try {
      const completed = localStorage.getItem(STORAGE_KEY);
      const replay = localStorage.getItem(REPLAY_STORAGE_KEY);
      if (!completed || replay === "true") {
        setVisible(true);
        localStorage.removeItem(REPLAY_STORAGE_KEY);
      }
    } catch {
      // localStorage unavailable (SSR / private browsing)
      setVisible(true);
    }
  }, []);

  const markDone = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // ignore
    }
    setVisible(false);
    onDone?.();
  }, [onDone]);

  const handleSkip = useCallback(() => {
    markDone();
  }, [markDone]);

  const handleNext = useCallback(() => {
    if (stepIndex < TOUR_STEPS.length - 1) {
      setStepIndex((i) => i + 1);
    } else {
      markDone();
    }
  }, [stepIndex, markDone]);

  const handlePrev = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  if (!visible) return null;

  const step = TOUR_STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
        aria-hidden="true"
        onClick={handleSkip}
      />

      {/* Tour card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-description"
        className="fixed z-50 inset-0 flex items-center justify-center p-4 pointer-events-none"
      >
        <div className="pointer-events-auto w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
          {/* Progress bar */}
          <div className="h-1 bg-slate-800">
            <div
              className="h-1 bg-violet-500 transition-all duration-500"
              style={{
                width: `${((stepIndex + 1) / TOUR_STEPS.length) * 100}%`,
              }}
              aria-hidden="true"
            />
          </div>

          <div className="p-6">
            {/* Step indicator */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex gap-1.5" role="list" aria-label="Tour steps">
                {TOUR_STEPS.map((s, i) => (
                  <div
                    key={s.id}
                    role="listitem"
                    aria-label={`Step ${i + 1}${i === stepIndex ? " (current)" : i < stepIndex ? " (completed)" : ""}`}
                    className={`w-2 h-2 rounded-full transition-all duration-300 ${
                      i === stepIndex
                        ? "bg-violet-500 scale-125"
                        : i < stepIndex
                          ? "bg-violet-800"
                          : "bg-slate-700"
                    }`}
                  />
                ))}
              </div>
              <span className="text-xs text-slate-500">
                {stepIndex + 1} / {TOUR_STEPS.length}
              </span>
            </div>

            {/* Icon & content */}
            <div className="flex gap-4 mb-6">
              <div
                className="flex-shrink-0 w-12 h-12 rounded-xl bg-violet-950/60 border border-violet-800/40 flex items-center justify-center text-2xl"
                aria-hidden="true"
              >
                {step.icon}
              </div>
              <div>
                <h2
                  id="tour-title"
                  className="text-lg font-bold text-slate-100 mb-1"
                >
                  {step.title}
                </h2>
                <p
                  id="tour-description"
                  className="text-sm text-slate-400 leading-relaxed"
                >
                  {step.description}
                </p>
              </div>
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={handleSkip}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded px-2 py-1"
              >
                Skip tour
              </button>

              <div className="flex gap-2">
                {!isFirst && (
                  <button
                    type="button"
                    onClick={handlePrev}
                    className="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                  >
                    Back
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleNext}
                  className="px-5 py-2 text-sm font-semibold text-white bg-violet-600 hover:bg-violet-500 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
                  autoFocus
                >
                  {isLast ? "Get Started 🚀" : "Next →"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Utility to trigger the onboarding tour replay.
 * Call this from a settings page or "Replay tour" button.
 */
export function triggerTourReplay() {
  try {
    localStorage.setItem(REPLAY_STORAGE_KEY, "true");
    // Reload or navigate to trigger the tour
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  } catch {
    // ignore
  }
}

export default OnboardingTour;
