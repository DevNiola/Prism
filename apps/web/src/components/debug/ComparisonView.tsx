"use client";

import React, { useState, useRef, useCallback } from "react";

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

export default function ComparisonView({
  title = "State Comparison",
  fields = [],
  beforeLabel = "Before (Pre-State)",
  afterLabel = "After (Post-State)",
}: ComparisonViewProps) {
  const [diffOnly, setDiffOnly] = useState(false);
  const [splitRatio, setSplitRatio] = useState(50); // percentage for left panel

  const leftPanelRef = useRef<HTMLDivElement | null>(null);
  const rightPanelRef = useRef<HTMLDivElement | null>(null);
  const isSyncingScroll = useRef(false);

  const handleScroll = useCallback(
    (source: "left" | "right") => {
      if (isSyncingScroll.current) return;
      isSyncingScroll.current = true;

      const sourceEl = source === "left" ? leftPanelRef.current : rightPanelRef.current;
      const targetEl = source === "left" ? rightPanelRef.current : leftPanelRef.current;

      if (sourceEl && targetEl) {
        targetEl.scrollTop = sourceEl.scrollTop;
      }

      requestAnimationFrame(() => {
        isSyncingScroll.current = false;
      });
    },
    []
  );

  const displayedFields = diffOnly
    ? fields.filter((f) => f.type !== "unchanged")
    : fields;

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

        <div className="flex items-center space-x-6">
          {/* Slider for panel ratio */}
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
            <span className="font-mono">{splitRatio}% / {100 - splitRatio}%</span>
          </div>

          {/* Diff Only Toggle */}
          <label className="flex items-center space-x-2 cursor-pointer select-none text-xs font-medium text-gray-700">
            <input
              type="checkbox"
              checked={diffOnly}
              onChange={(e) => setDiffOnly(e.target.checked)}
              className="sr-only"
            />
            <div
              className={`w-9 h-5 rounded-full transition-colors relative ${
                diffOnly ? "bg-purple-600" : "bg-gray-300"
              }`}
            >
              <div
                className={`w-3.5 h-3.5 bg-white rounded-full absolute top-0.75 transition-transform ${
                  diffOnly ? "translate-x-4.5" : "translate-x-1"
                }`}
              />
            </div>
            <span>Diff Only</span>
          </label>
        </div>
      </div>

      {/* Side-by-Side Panels Header */}
      <div className="grid grid-cols-2 border-b border-gray-200 text-xs font-semibold text-gray-600 bg-gray-100">
        <div
          className="p-3 border-r border-gray-200"
          style={{ width: "100%" }}
        >
          {beforeLabel}
        </div>
        <div className="p-3">
          {afterLabel}
        </div>
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

            let bg = "bg-gray-50 border-gray-200";
            if (isRemoved) bg = "bg-rose-50 border-rose-300 text-rose-900";
            else if (isModified) bg = "bg-amber-50 border-amber-300 text-amber-900";
            else if (isAdded) bg = "bg-gray-50 border-dashed border-gray-200 opacity-40";

            return (
              <div
                key={`before-${idx}`}
                className={`p-2.5 rounded border text-xs font-mono transition-colors ${bg}`}
              >
                <div className="font-bold truncate text-gray-800 mb-1">{field.key}</div>
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

            let bg = "bg-gray-50 border-gray-200";
            if (isAdded) bg = "bg-emerald-50 border-emerald-300 text-emerald-900";
            else if (isModified) bg = "bg-amber-50 border-amber-300 text-amber-900";
            else if (isRemoved) bg = "bg-gray-50 border-dashed border-gray-200 opacity-40";

            return (
              <div
                key={`after-${idx}`}
                className={`p-2.5 rounded border text-xs font-mono transition-colors ${bg}`}
              >
                <div className="font-bold truncate text-gray-800 mb-1">{field.key}</div>
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
