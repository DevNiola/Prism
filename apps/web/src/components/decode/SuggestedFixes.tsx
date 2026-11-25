"use client";

import { useState } from "react";
import type { SuggestedFix } from "@/lib/types";
import { useToast } from "@/hooks/useToast";
import { useSessionStore } from "@/store/session";
import type { FixDifficultyFilter } from "@/store/session";

interface SuggestedFixesProps {
  fixes: SuggestedFix[];
}

function difficultyStyle(difficulty: string): string {
  switch (difficulty.toLowerCase()) {
    case "easy":
      return "border-emerald-800 bg-emerald-950/60 text-emerald-300";
    case "hard":
      return "border-rose-800 bg-rose-950/60 text-rose-300";
    default:
      return "border-amber-800 bg-amber-950/60 text-amber-300";
  }
}

const FILTER_OPTIONS: { label: string; value: FixDifficultyFilter }[] = [
  { label: "All", value: "all" },
  { label: "Easy", value: "easy" },
  { label: "Medium", value: "medium" },
  { label: "Hard", value: "hard" },
];

export default function SuggestedFixes({ fixes }: SuggestedFixesProps) {
  const [copyStatus, setCopyStatus] = useState<Record<number, string>>({});
  const { showToast } = useToast();
  const fixDifficultyFilter = useSessionStore((s) => s.fixDifficultyFilter);
  const setFixDifficultyFilter = useSessionStore(
    (s) => s.setFixDifficultyFilter
  );

  const filteredFixes =
    fixDifficultyFilter === "all"
      ? fixes
      : fixes.filter(
          (fix) =>
            fix.difficulty.toLowerCase() === fixDifficultyFilter.toLowerCase()
        );

  async function copyFix(index: number, fix: SuggestedFix) {
    const text =
      fix.description + (fix.example ? "\n\n" + fix.example : "");
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus((current) => ({ ...current, [index]: "Copied" }));
      showToast("Fix copied to clipboard", "success");
    } catch {
      setCopyStatus((current) => ({ ...current, [index]: "Copy failed" }));
    }
  }

  return (
    <section aria-labelledby="suggested-fixes-heading">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h3
            id="suggested-fixes-heading"
            className="text-sm font-semibold text-slate-100"
          >
            Suggested fixes
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Practical next steps for this error
          </p>
        </div>
        <span className="font-mono text-xs text-slate-500">
          {fixes.length.toString().padStart(2, "0")}
        </span>
      </div>

      {/* Difficulty filter bar */}
      <div
        className="mb-4 flex flex-wrap gap-1"
        role="group"
        aria-label="Filter fixes by difficulty"
      >
        {FILTER_OPTIONS.map(({ label, value }) => (
          <button
            key={value}
            type="button"
            onClick={() => setFixDifficultyFilter(value)}
            aria-pressed={fixDifficultyFilter === value}
            className={`rounded border px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-600 ${
              fixDifficultyFilter === value
                ? "border-emerald-600 bg-emerald-900/60 text-emerald-300"
                : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500 hover:text-slate-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {filteredFixes.length > 0 ? (
        <ol className="space-y-3">
          {filteredFixes.map((fix, index) => (
            <li
              key={`${fix.description}-${index}`}
              className="rounded border border-slate-800 bg-slate-950/70 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 gap-3">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded bg-emerald-950 text-xs font-bold text-emerald-300">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm leading-relaxed text-slate-200">
                      {fix.description}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase ${difficultyStyle(fix.difficulty)}`}
                      >
                        {fix.difficulty} effort
                      </span>
                      {fix.requires_upgrade && (
                        <span className="rounded border border-slate-700 px-2 py-0.5 text-[10px] font-medium uppercase text-slate-400">
                          Upgrade required
                        </span>
                      )}
                    </div>
                    {fix.example && (
                      <pre className="mt-3 overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-300">
                        <code>{fix.example}</code>
                      </pre>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void copyFix(index, fix)}
                  aria-label={`Copy fix ${index + 1} to clipboard`}
                  className="inline-flex shrink-0 items-center gap-2 rounded border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:border-emerald-700 hover:text-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                >
                  <span aria-hidden="true">
                    {copyStatus[index] === "Copied" ? "✓" : "⧉"}
                  </span>
                  {copyStatus[index] ?? "Copy fix"}
                </button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-500">
          {fixes.length > 0
            ? "No fixes match the selected difficulty filter."
            : "No suggested fixes are documented for this error."}
        </p>
      )}
    </section>
  );
}
