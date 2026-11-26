"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";

export interface DiffField {
  key: string;
  before?: string | null;
  after?: string | null;
  type: "added" | "deleted" | "modified" | "unchanged";
}

export interface ComparisonViewProps {
  title?: string;
  fields?: DiffField[];
  beforeLabel?: string;
  afterLabel?: string;
}

const CHANGE_TYPES: DiffField["type"][] = ["added", "deleted", "modified"];

export default function ComparisonView({
  title = "State Comparison",
  fields = [],
  beforeLabel = "Before (Pre-State)",
  afterLabel = "After (Post-State)",
}: ComparisonViewProps) {
  const [changesOnly, setChangesOnly] = useState(false);
  const [splitRatio, setSplitRatio] = useState(50);
  const [currentChangeIdx, setCurrentChangeIdx] = useState(0);

  const leftPanelRef = useRef<HTMLDivElement | null>(null);
  const rightPanelRef = useRef<HTMLDivElement | null>(null);
  const isSyncingScroll = useRef(false);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const handleScroll = useCallback((source: "left" | "right") => {
    if (isSyncingScroll.current) return;
    isSyncingScroll.current = true;

    const sourceEl =
      source === "left" ? leftPanelRef.current : rightPanelRef.current;
    const targetEl =
      source === "left" ? rightPanelRef.current : leftPanelRef.current;

    if (sourceEl && targetEl) {
      targetEl.scrollTop = sourceEl.scrollTop;
    }

    requestAnimationFrame(() => {
      isSyncingScroll.current = false;
    });
  }, []);

  const displayedFields = changesOnly
    ? fields.filter((f) => f.type !== "unchanged")
    : fields;

  // Indices (into displayedFields) that represent an actual change
  const changeIndices = displayedFields
    .map((f, i) => (CHANGE_TYPES.includes(f.type) ? i : -1))
    .filter((i) => i !== -1);

  // Auto-scroll to the first change whenever fields change
  useEffect(() => {
    setCurrentChangeIdx(0);
    if (changeIndices.length > 0) {
      const el = rowRefs.current.get(changeIndices[0]);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    // changeIndices is derived from fields — rerun when fields change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields]);

  const scrollToChange = (idx: number) => {
    const rowIdx = changeIndices[idx];
    if (rowIdx === undefined) return;
    const el = rowRefs.current.get(rowIdx);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const goToPrevChange = () => {
    const next =
      (currentChangeIdx - 1 + changeIndices.length) % changeIndices.length;
    setCurrentChangeIdx(next);
    scrollToChange(next);
  };

  const goToNextChange = () => {
    const next = (currentChangeIdx + 1) % changeIndices.length;
    setCurrentChangeIdx(next);
    scrollToChange(next);
  };

  const addedCount = fields.filter((f) => f.type === "added").length;
  const deletedCount = fields.filter((f) => f.type === "deleted").length;
  const modifiedCount = fields.filter((f) => f.type === "modified").length;

  return (
    <div className="bg-white rounded-lg shadow border border-gray-200 flex flex-col h-full max-h-[750px]">
      {/* Header and Controls */}
      <div className="p-4 border-b border-gray-200 flex flex-wrap items-center justify-between gap-4 bg-gray-50 rounded-t-lg">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <div className="flex items-center space-x-2 text-xs mt-1">
            <span className="text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full font-medium">
              +{addedCount} added
            </span>
            <span className="text-rose-700 bg-rose-100 px-2 py-0.5 rounded-full font-medium">
              -{deletedCount} removed
            </span>
            <span className="text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full font-medium">
              ~{modifiedCount} modified
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {/* Prev / Next change navigation */}
          {changeIndices.length > 0 && (
            <div className="flex items-center gap-1 text-xs text-gray-600">
              <button
                type="button"
                onClick={goToPrevChange}
                className="px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100 min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Previous change"
              >
                ← Prev
              </button>
              <span className="font-mono px-1">
                {currentChangeIdx + 1}/{changeIndices.length}
              </span>
              <button
                type="button"
                onClick={goToNextChange}
                className="px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100 min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Next change"
              >
                Next →
              </button>
            </div>
          )}

          {/* Split ratio slider */}
          <div className="flex items-center space-x-2 text-xs text-gray-600">
            <span>Split:</span>
            <input
              type="range"
              min={25}
              max={75}
              value={splitRatio}
              onChange={(e) => setSplitRatio(Number(e.target.value))}
              className="w-24 h-1.5 bg-gray-300 rounded-lg appearance-none cursor-pointer accent-purple-600"
            />
            <span className="font-mono">
              {splitRatio}% / {100 - splitRatio}%
            </span>
          </div>

          {/* Changes Only toggle */}
          <label className="flex items-center space-x-2 cursor-pointer select-none text-xs font-medium text-gray-700">
            <input
              type="checkbox"
              checked={changesOnly}
              onChange={(e) => setChangesOnly(e.target.checked)}
              className="sr-only"
            />
            <div
              className={`w-9 h-5 rounded-full transition-colors relative ${
                changesOnly ? "bg-purple-600" : "bg-gray-300"
              }`}
            >
              <div
                className={`w-3.5 h-3.5 bg-white rounded-full absolute top-[3px] transition-transform ${
                  changesOnly ? "translate-x-[18px]" : "translate-x-[4px]"
                }`}
              />
            </div>
            <span>Changes Only</span>
          </label>
        </div>
      </div>

      {/* Panel Headers */}
      <div className="grid grid-cols-2 border-b border-gray-200 text-xs font-semibold text-gray-600 bg-gray-100">
        <div className="p-3 border-r border-gray-200">{beforeLabel}</div>
        <div className="p-3">{afterLabel}</div>
      </div>

      {/* Synchronized Scrolling Panels */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel (Before) */}
        <div
          ref={leftPanelRef}
          onScroll={() => handleScroll("left")}
          style={{ width: `${splitRatio}%` }}
          className="overflow-y-auto p-4 border-r border-gray-200 space-y-2 select-text"
        >
          {displayedFields.map((field, idx) => {
            const isRemoved = field.type === "deleted";
            const isModified = field.type === "modified";
            const isAdded = field.type === "added";
            const isTarget = changeIndices[currentChangeIdx] === idx;

            let bg = "bg-gray-50 border-gray-200";
            if (isRemoved) bg = "bg-rose-50 border-rose-300 text-rose-900";
            else if (isModified)
              bg = "bg-amber-50 border-amber-300 text-amber-900";
            else if (isAdded)
              bg = "bg-gray-50 border-dashed border-gray-200 opacity-40";

            const keyColor = isRemoved
              ? "text-rose-700"
              : isModified
                ? "text-amber-700"
                : isAdded
                  ? "text-gray-400"
                  : "text-gray-800";

            return (
              <div
                key={`before-${idx}`}
                ref={(el) => {
                  if (el) rowRefs.current.set(idx, el);
                  else rowRefs.current.delete(idx);
                }}
                className={`p-2.5 rounded border text-xs font-mono transition-colors ${bg} ${
                  isTarget ? "ring-2 ring-purple-400" : ""
                }`}
              >
                <div className={`font-bold truncate mb-1 ${keyColor}`}>
                  {isAdded && (
                    <span className="mr-1 text-emerald-600">+</span>
                  )}
                  {isRemoved && (
                    <span className="mr-1 text-rose-600">−</span>
                  )}
                  {isModified && (
                    <span className="mr-1 text-amber-600">~</span>
                  )}
                  {field.key}
                </div>
                <div className="break-all whitespace-pre-wrap">
                  {isAdded ? "<not present>" : field.before ?? "null"}
                </div>
              </div>
            );
          })}
          {displayedFields.length === 0 && (
            <div className="text-center py-12 text-xs text-gray-400">
              No differences to display
            </div>
          )}
        </div>

        {/* Right Panel (After) */}
        <div
          ref={rightPanelRef}
          onScroll={() => handleScroll("right")}
          style={{ width: `${100 - splitRatio}%` }}
          className="overflow-y-auto p-4 space-y-2 select-text"
        >
          {displayedFields.map((field, idx) => {
            const isRemoved = field.type === "deleted";
            const isModified = field.type === "modified";
            const isAdded = field.type === "added";
            const isTarget = changeIndices[currentChangeIdx] === idx;

            let bg = "bg-gray-50 border-gray-200";
            if (isAdded)
              bg = "bg-emerald-50 border-emerald-300 text-emerald-900";
            else if (isModified)
              bg = "bg-amber-50 border-amber-300 text-amber-900";
            else if (isRemoved)
              bg = "bg-gray-50 border-dashed border-gray-200 opacity-40";

            const keyColor = isAdded
              ? "text-emerald-700"
              : isModified
                ? "text-amber-700"
                : isRemoved
                  ? "text-gray-400"
                  : "text-gray-800";

            return (
              <div
                key={`after-${idx}`}
                className={`p-2.5 rounded border text-xs font-mono transition-colors ${bg} ${
                  isTarget ? "ring-2 ring-purple-400" : ""
                }`}
              >
                <div className={`font-bold truncate mb-1 ${keyColor}`}>
                  {isAdded && (
                    <span className="mr-1 text-emerald-600">+</span>
                  )}
                  {isRemoved && (
                    <span className="mr-1 text-rose-600">−</span>
                  )}
                  {isModified && (
                    <span className="mr-1 text-amber-600">~</span>
                  )}
                  {field.key}
                </div>
                <div className="break-all whitespace-pre-wrap">
                  {isRemoved ? "<deleted>" : field.after ?? "null"}
                </div>
              </div>
            );
          })}
          {displayedFields.length === 0 && (
            <div className="text-center py-12 text-xs text-gray-400">
              No differences to display
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
