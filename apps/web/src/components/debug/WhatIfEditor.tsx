"use client";

import { useState, useMemo } from "react";

interface ArgEntry {
  key: string;
  original: string;
  edited: string;
}

function parseScVal(raw: string): { ok: boolean; decoded: unknown } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, decoded: null };
  try {
    return { ok: true, decoded: JSON.parse(trimmed) };
  } catch {
    // Treat as a plain string ScVal
    return { ok: true, decoded: trimmed };
  }
}

interface WhatIfEditorProps {
  initialArgs?: Record<string, string>;
  onSubmit?: (args: Record<string, string>) => void;
}

export default function WhatIfEditor({
  initialArgs = { param1: '"hello"', param2: "42" },
  onSubmit,
}: WhatIfEditorProps) {
  const [args, setArgs] = useState<ArgEntry[]>(() =>
    Object.entries(initialArgs).map(([key, value]) => ({
      key,
      original: value,
      edited: value,
    }))
  );

  const parsed = useMemo(
    () =>
      args.map((arg) => ({
        key: arg.key,
        changed: arg.original.trim() !== arg.edited.trim(),
        ...parseScVal(arg.edited),
      })),
    [args]
  );

  const allValid = parsed.every((p) => p.ok);
  const anyChanged = parsed.some((p) => p.changed);
  const canSubmit = allValid && anyChanged;

  function handleEdit(index: number, value: string) {
    setArgs((prev) =>
      prev.map((arg, i) => (i === index ? { ...arg, edited: value } : arg))
    );
  }

  function handleSubmit() {
    if (!canSubmit) return;
    const result: Record<string, string> = {};
    args.forEach((arg) => {
      result[arg.key] = arg.edited;
    });
    onSubmit?.(result);
  }

  return (
    <div className="rounded-xl border border-white/10 bg-[#0f1117] p-6 font-mono text-sm text-white">
      <h2 className="mb-4 text-base font-semibold text-white/90">
        What-If Editor
      </h2>

      {/* Side-by-side original vs edited preview */}
      <div className="mb-6 overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-white/10 bg-white/5 text-white/50">
              <th className="px-4 py-2 text-left font-medium">Argument</th>
              <th className="px-4 py-2 text-left font-medium">Original</th>
              <th className="px-4 py-2 text-left font-medium">Edited</th>
            </tr>
          </thead>
          <tbody>
            {args.map((arg, i) => {
              const p = parsed[i];
              return (
                <tr
                  key={arg.key}
                  className={`border-b border-white/5 last:border-b-0 ${
                    p.changed ? "bg-indigo-900/20" : ""
                  }`}
                >
                  {/* Argument name */}
                  <td className="px-4 py-3 text-white/60">{arg.key}</td>

                  {/* Original — read-only */}
                  <td className="px-4 py-3">
                    <span className="rounded bg-black/30 px-2 py-1 text-green-400">
                      {arg.original}
                    </span>
                  </td>

                  {/* Editable + inline decoded preview */}
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <input
                        type="text"
                        value={arg.edited}
                        onChange={(e) => handleEdit(i, e.target.value)}
                        aria-label={`Edit ${arg.key}`}
                        className={`w-full rounded border bg-black/40 px-2 py-1 text-xs focus:outline-none focus:ring-1 ${
                          !p.ok
                            ? "border-red-500/60 text-red-400 focus:ring-red-500"
                            : p.changed
                              ? "border-indigo-500/60 text-indigo-200 focus:ring-indigo-500"
                              : "border-white/10 text-white/80 focus:ring-white/20"
                        }`}
                      />

                      {/* Decoded value hint */}
                      {p.changed && p.ok && (
                        <span className="text-[10px] text-indigo-400">
                          → {JSON.stringify(p.decoded)}
                        </span>
                      )}
                      {!p.ok && (
                        <span className="text-[10px] text-red-400">
                          Cannot parse as ScVal
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-indigo-400"
      >
        Submit
      </button>

      {!allValid && (
        <p className="mt-2 text-xs text-red-400">
          Fix invalid values before submitting.
        </p>
      )}
      {allValid && !anyChanged && (
        <p className="mt-2 text-xs text-white/40">
          Edit at least one argument to enable submit.
        </p>
      )}
    </div>
  );
}
