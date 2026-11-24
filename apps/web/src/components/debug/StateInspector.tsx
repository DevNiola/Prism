"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";

import EmptyState from "@/components/shared/EmptyState";

const ROW_HEIGHT = 40;
const VISIBLE_ROWS = 5;
const OVERSCAN = 2;

export interface StateInspectorProps {
  currentStep?: number;
  contractId?: string;
  functionName?: string;
  callDepth?: number;
  remainingCpu?: number;
  remainingMemory?: number;
  storageEntries?: Array<{ key: string; value: string; changed?: boolean }>;
  authContext?: string[];
  transitionDurationMs?: number;
}

export default function StateInspector({
  currentStep = 0,
  contractId = "CBDL...4UXK",
  functionName = "invoke",
  callDepth = 1,
  remainingCpu = 850000,
  remainingMemory = 4200000,
  storageEntries = [],
  authContext = [],
  transitionDurationMs = 200,
}: StateInspectorProps) {
  const [animating, setAnimating] = useState(false);
  const [displayedStep, setDisplayedStep] = useState(currentStep);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  const [query, setQuery] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const matchingEntries = useMemo(() => {
    const search = query.trim().toLowerCase();
    return search
      ? storageEntries.filter(({ key }) => key.toLowerCase().includes(search))
      : storageEntries;
  }, [query, storageEntries]);

  const maxScrollTop = Math.max(0, matchingEntries.length - VISIBLE_ROWS) * ROW_HEIGHT;
  const firstVisibleRow = Math.floor(Math.min(scrollTop, maxScrollTop) / ROW_HEIGHT);
  const start = Math.max(0, firstVisibleRow - OVERSCAN);
  const end = firstVisibleRow + VISIBLE_ROWS + OVERSCAN + 1;

  function updateQuery(value: string) {
    setQuery(value);
    setScrollTop(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }

  useEffect(() => {
    setAnimating(true);
    const timer = setTimeout(() => {
      setDisplayedStep(currentStep);
      setAnimating(false);
    }, transitionDurationMs / 2);

    return () => clearTimeout(timer);
  }, [currentStep, transitionDurationMs]);

  return (
    <div className="bg-white rounded-lg shadow p-4 md:p-6 border border-gray-200">
      <div className="flex items-center justify-between pb-4 border-b border-gray-100 mb-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">State Inspector</h2>
          <p className="text-xs text-gray-500">Live contract execution environment</p>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-xs text-gray-500 font-mono">Step #{displayedStep}</span>
          <span className="hidden sm:inline-block px-2 py-0.5 text-xs bg-purple-100 text-purple-700 font-medium rounded-full">
            {transitionDurationMs}ms transition
          </span>
          {/* Mobile drawer toggle */}
          <button
            type="button"
            onClick={() => setIsMobileDrawerOpen(!isMobileDrawerOpen)}
            className="md:hidden px-2.5 py-1 text-xs font-semibold rounded bg-purple-50 text-purple-700 border border-purple-200"
          >
            {isMobileDrawerOpen ? "Close Drawer" : "Open Drawer"}
          </button>
        </div>
      </div>

      {/* Step details container - collapsible drawer on mobile, static on desktop */}
      <div
        style={{
          transitionDuration: `${transitionDurationMs}ms`,
        }}
        className={`${
          isMobileDrawerOpen ? "block" : "hidden md:block"
        } space-y-4 transition-all transform ${
          animating
            ? "opacity-50 translate-y-1 scale-[0.99]"
            : "opacity-100 translate-y-0 scale-100"
        }`}
      >
        {/* Execution Frame Info */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-gray-50 p-3 rounded-lg border border-gray-100">
          <div>
            <span className="text-[10px] uppercase font-bold text-gray-400">Contract</span>
            <div className="text-xs font-mono font-medium text-gray-800 truncate" title={contractId}>
              {contractId}
            </div>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-gray-400">Function</span>
            <div className="text-xs font-mono font-medium text-purple-600 truncate">
              {functionName}()
            </div>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-gray-400">Call Depth</span>
            <div className="text-xs font-mono font-medium text-gray-800">
              Depth {callDepth}
            </div>
          </div>
          <div>
            <span className="text-[10px] uppercase font-bold text-gray-400">CPU Remaining</span>
            <div className="text-xs font-mono font-medium text-emerald-600">
              {remainingCpu.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Visible Storage Entries */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-700">Contract Storage</h3>
            <span className="text-xs text-gray-600" role="status">
              {matchingEntries.length} matching {matchingEntries.length === 1 ? "entry" : "entries"}
            </span>
          </div>
          <input
            type="search"
            aria-label="Search storage keys"
            placeholder="Search storage keys"
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
            className="mb-2 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
          />
          {matchingEntries.length > 0 ? (
            <div
              ref={listRef}
              role="region"
              aria-label="Contract storage entries"
              tabIndex={0}
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
              className="overflow-y-auto"
              style={{ maxHeight: VISIBLE_ROWS * ROW_HEIGHT }}
            >
              <div role="list" className="relative" style={{ height: matchingEntries.length * ROW_HEIGHT }}>
                {matchingEntries.slice(start, end).map((entry, offset) => {
                  const index = start + offset;
                  return (
                    <div
                      key={index}
                      role="listitem"
                      aria-posinset={index + 1}
                      aria-setsize={matchingEntries.length}
                      style={{
                        top: index * ROW_HEIGHT,
                        height: ROW_HEIGHT - 4,
                        transitionDuration: `${transitionDurationMs}ms`,
                      }}
                      className={`absolute inset-x-0 flex items-center gap-2 rounded border px-2 font-mono text-xs transition-colors ${
                        entry.changed
                          ? "border-amber-200 bg-amber-50 text-amber-900"
                          : "border-gray-100 bg-gray-50 text-gray-700"
                      }`}
                    >
                      <span title={entry.key} className="flex-1 truncate font-semibold text-gray-800">
                        {entry.key}
                      </span>
                      <span title={entry.value} className="flex-1 truncate text-right text-gray-500">
                        {entry.value}
                      </span>
                      {entry.changed && (
                        <span className="shrink-0 rounded bg-amber-200 px-1.5 font-sans text-[10px] text-amber-800">
                          modified
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <EmptyState
              title={query.trim() ? "No matching storage entries" : "No storage accessed at this step"}
              description={query.trim() ? "Try a different key substring." : "Storage entries appear when this step accesses contract storage."}
            />
          )}
        </div>

        {/* Auth Context */}
        {authContext.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Auth Invocations</h3>
            <div className="space-y-1">
              {authContext.map((auth, idx) => (
                <div
                  key={idx}
                  className="p-2 text-xs font-mono bg-blue-50 border border-blue-100 text-blue-800 rounded"
                >
                  {auth}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
