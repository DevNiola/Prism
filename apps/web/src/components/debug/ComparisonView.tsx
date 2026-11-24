"use client";

import { useLayoutEffect, useRef, useState } from "react";

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

const rowColors = {
  added: "border-emerald-300 bg-emerald-50 text-emerald-900",
  deleted: "border-rose-300 bg-rose-50 text-rose-900",
  modified: "border-amber-300 bg-amber-50 text-amber-900",
  unchanged: "border-gray-200 bg-gray-50 text-gray-800",
};

function getFieldType(field: DiffField): DiffField["type"] {
  if (field.type === "added" || field.type === "deleted") return field.type;
  return (field.before ?? null) === (field.after ?? null) ? "unchanged" : "modified";
}

export default function ComparisonView({
  title = "State Comparison",
  fields = [],
  beforeLabel = "Before (Pre-State)",
  afterLabel = "After (Post-State)",
}: ComparisonViewProps) {
  const [diffOnly, setDiffOnly] = useState(false);
  const [splitRatio, setSplitRatio] = useState(50);
  const [selectedKey, setSelectedKey] = useState<string>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLDivElement>(null);

  const rows = fields.map((field) => ({ ...field, type: getFieldType(field) }));
  const changes = rows.filter(({ type }) => type !== "unchanged");
  const selectedIndex = changes.findIndex(({ key }) => key === selectedKey);
  const activeIndex = Math.max(0, selectedIndex);
  const activeKey = changes[activeIndex]?.key;
  const displayedRows = diffOnly ? changes : rows;
  const activeRowIndex = displayedRows.findIndex(({ key }) => key === activeKey);
  const columns = { gridTemplateColumns: `minmax(0, ${splitRatio}fr) minmax(0, ${100 - splitRatio}fr)` };

  useLayoutEffect(() => {
    const row = activeRowRef.current;
    const scroller = scrollRef.current;
    if (row && scroller) {
      scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    }
  }, [activeKey, activeRowIndex, diffOnly]);

  return (
    <section className="flex max-h-[750px] flex-col rounded-lg border border-gray-200 bg-white shadow">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-t-lg border-b border-gray-200 bg-gray-50 p-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <div className="mt-1 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-emerald-100 px-2 text-emerald-800">
              {changes.filter(({ type }) => type === "added").length} added
            </span>
            <span className="rounded-full bg-rose-100 px-2 text-rose-800">
              {changes.filter(({ type }) => type === "deleted").length} removed
            </span>
            <span className="rounded-full bg-amber-100 px-2 text-amber-800">
              {changes.filter(({ type }) => type === "modified").length} modified
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-700">
          <label className="flex items-center gap-2">
            Split
            <input
              type="range"
              min={25}
              max={75}
              value={splitRatio}
              onChange={(event) => setSplitRatio(Number(event.target.value))}
              className="w-24 accent-purple-600"
            />
            <span>{splitRatio}% / {100 - splitRatio}%</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={diffOnly}
              onChange={(event) => setDiffOnly(event.target.checked)}
              className="accent-purple-600"
            />
            Diff only
          </label>
        </div>

        <div role="group" aria-label="Navigate changes" className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            disabled={activeIndex === 0}
            onClick={() => setSelectedKey(changes[activeIndex - 1].key)}
            className="rounded border border-gray-300 px-2 py-1 disabled:opacity-50"
          >
            Previous change
          </button>
          <span aria-live="polite" className="text-gray-600">
            {changes.length ? `${activeIndex + 1} of ${changes.length}` : "No changes"}
          </span>
          <button
            type="button"
            disabled={activeIndex + 1 >= changes.length}
            onClick={() => setSelectedKey(changes[activeIndex + 1].key)}
            className="rounded border border-gray-300 px-2 py-1 disabled:opacity-50"
          >
            Next change
          </button>
        </div>
      </div>

      <div className="grid border-b border-gray-200 bg-gray-100 text-xs font-semibold text-gray-700" style={columns}>
        <div className="border-r border-gray-200 p-3">{beforeLabel}</div>
        <div className="p-3">{afterLabel}</div>
      </div>

      <div ref={scrollRef} tabIndex={0} aria-label="Comparison rows" role="region" className="min-h-0 overflow-y-auto">
        {displayedRows.map((field, index) => {
          const active = index === activeRowIndex;
          return (
            <div
              key={field.key}
              ref={active ? activeRowRef : undefined}
              aria-current={active ? "true" : undefined}
              className="grid gap-2 px-3 py-1"
              style={columns}
            >
              {(["before", "after"] as const).map((side) => {
                const absent = side === "before" ? field.type === "added" : field.type === "deleted";
                return (
                  <div
                    key={side}
                    className={`rounded border p-2.5 font-mono text-xs ${rowColors[field.type]} ${active ? "ring-2 ring-inset ring-purple-600" : ""}`}
                  >
                    <div className="mb-1 break-all font-bold">{field.key}</div>
                    <div className="whitespace-pre-wrap break-all">
                      {absent ? (side === "before" ? "<not present>" : "<deleted>") : field[side] ?? "null"}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
        {displayedRows.length === 0 && (
          <p className="py-12 text-center text-xs text-gray-500">No differences to display</p>
        )}
      </div>
    </section>
  );
}
