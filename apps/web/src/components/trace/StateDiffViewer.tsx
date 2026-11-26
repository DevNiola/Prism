"use client";

import { useState, useCallback } from "react";
import Skeleton from "@/components/shared/Skeleton";
import { useToast } from "@/hooks/useToast";

interface StateDiffViewerProps {
  entries: Array<{
    key: string;
    before?: string;
    after?: string;
    change_type: string;
  }>;
  loading?: boolean;
}

const DIFF_ROWS = 2;
const TRUNCATE_LENGTH = 200;

function parseJson(value?: string): { parsed: unknown; valid: boolean } {
  if (value === undefined) return { parsed: undefined, valid: false };
  try {
    return { parsed: JSON.parse(value), valid: true };
  } catch {
    return { parsed: value, valid: false };
  }
}

function areDeeplyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || left === null) return false;
  if (typeof right !== "object" || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => areDeeplyEqual(value, right[index]))
    );
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(rightRecord, key) &&
        areDeeplyEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

function getChangeType(entry: StateDiffViewerProps["entries"][number]) {
  if (entry.before === undefined) return "created";
  if (entry.after === undefined) return "deleted";
  const before = parseJson(entry.before);
  const after = parseJson(entry.after);
  if (before.valid && after.valid) {
    return areDeeplyEqual(before.parsed, after.parsed) ? "unchanged" : "updated";
  }
  return entry.change_type.toLowerCase();
}

function ExpandableValue({ value, label }: { value: string; label: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = value.length > TRUNCATE_LENGTH;
  const display =
    isLong && !expanded ? value.slice(0, TRUNCATE_LENGTH) + "…" : value;

  return (
    <div>
      <div className="text-xs text-gray-600 mb-1">{label}</div>
      <pre className="text-xs bg-white p-2 rounded border overflow-x-auto whitespace-pre-wrap break-all">
        {display}
      </pre>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs text-indigo-600 hover:underline focus:outline-none"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

/**
 * Placeholder mirroring the two-column before/after layout of the diff entries
 * so the card keeps its height while state changes are still streaming in.
 */
export function StateDiffViewerSkeleton() {
  return (
    <div className="bg-white rounded-lg shadow p-6" aria-busy="true">
      <h2 className="text-xl font-semibold mb-4">State Diff</h2>
      <div className="space-y-3">
        {Array.from({ length: DIFF_ROWS }, (_, index) => (
          <div key={index} className="p-4 border border-gray-200 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-6 w-20" />
            </div>
            <div className="grid grid-cols-2 gap-4 mt-3">
              <div>
                <Skeleton className="mb-1 h-3 w-12" />
                <Skeleton className="h-10 w-full" />
              </div>
              <div>
                <Skeleton className="mb-1 h-3 w-12" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StateDiffViewer({ entries, loading }: StateDiffViewerProps) {
  const [showOnlyChanges, setShowOnlyChanges] = useState(false);
  const [viewMode, setViewMode] = useState<"side-by-side" | "stacked">(
    "side-by-side",
  );
  const { showToast } = useToast();

  const handleCopy = useCallback(
    (entry: StateDiffViewerProps["entries"][number]) => {
      const text = `${entry.key}: ${entry.before ?? "(none)"} -> ${entry.after ?? "(none)"}`;
      navigator.clipboard.writeText(text).then(
        () => showToast("Diff entry copied to clipboard", "success"),
        () => showToast("Failed to copy to clipboard", "error"),
      );
    },
    [showToast],
  );

  if (loading && entries.length === 0) {
    return <StateDiffViewerSkeleton />;
  }

  const getChangeColor = (changeType: string) => {
    switch (changeType) {
      case "created":
        return "bg-green-50 border-green-200";
      case "updated":
        return "bg-yellow-50 border-yellow-300";
      case "deleted":
        return "bg-red-50 border-red-200";
      default:
        return "bg-gray-50 border-gray-200";
    }
  };

  const getChangeBadge = (changeType: string) => {
    switch (changeType) {
      case "created":
        return (
          <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded">
            Created
          </span>
        );
      case "updated":
        return (
          <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded">
            Updated
          </span>
        );
      case "deleted":
        return (
          <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded">
            Deleted
          </span>
        );
      default:
        return (
          <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-800 rounded">
            Unchanged
          </span>
        );
    }
  };

  const visibleEntries = entries
    .map((entry) => ({ entry, changeType: getChangeType(entry) }))
    .filter(
      ({ changeType }) => !showOnlyChanges || changeType !== "unchanged",
    );

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">State Diff</h2>

        <div className="flex flex-wrap items-center gap-3">
          {/* View mode toggle */}
          <div className="flex items-center rounded-md border border-gray-200 overflow-hidden text-xs font-medium">
            <button
              type="button"
              onClick={() => setViewMode("side-by-side")}
              className={`px-3 py-1.5 transition-colors ${
                viewMode === "side-by-side"
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              Side by Side
            </button>
            <button
              type="button"
              onClick={() => setViewMode("stacked")}
              className={`px-3 py-1.5 transition-colors ${
                viewMode === "stacked"
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              Stacked
            </button>
          </div>

          {/* Show only changes toggle */}
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={showOnlyChanges}
              onChange={(event) => setShowOnlyChanges(event.target.checked)}
              className="h-4 w-4 accent-indigo-600"
            />
            Show only changes
          </label>
        </div>
      </div>

      <div className="space-y-3">
        {visibleEntries.map(({ entry, changeType }, idx) => (
          <div
            key={`${entry.key}-${idx}`}
            className={`p-4 border rounded-lg ${getChangeColor(changeType)}`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-sm font-medium">{entry.key}</span>
              <div className="flex items-center gap-2">
                {getChangeBadge(changeType)}
                <button
                  type="button"
                  onClick={() => handleCopy(entry)}
                  title="Copy diff entry"
                  className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-white/70 transition-colors"
                  aria-label={`Copy diff for ${entry.key}`}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {viewMode === "side-by-side" ? (
              <div className="grid grid-cols-2 gap-4 mt-3">
                <ExpandableValue
                  value={entry.before ?? "(none)"}
                  label="Before"
                />
                <ExpandableValue
                  value={entry.after ?? "(none)"}
                  label="After"
                />
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <ExpandableValue
                  value={entry.before ?? "(none)"}
                  label="Before"
                />
                <ExpandableValue
                  value={entry.after ?? "(none)"}
                  label="After"
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {visibleEntries.length === 0 && (
        <p className="text-gray-500 text-center py-8">
          {entries.length > 0 && showOnlyChanges
            ? "No changes to show."
            : "No state changes detected yet."}
        </p>
      )}
    </div>
  );
}

export default StateDiffViewer;
