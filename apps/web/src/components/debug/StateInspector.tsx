"use client";

import React, { useState, useEffect } from "react";

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
            <span className="text-xs text-gray-400">{storageEntries.length} entries</span>
          </div>
          {storageEntries.length > 0 ? (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {storageEntries.map((entry, idx) => (
                <div
                  key={idx}
                  style={{
                    transitionDuration: `${transitionDurationMs}ms`,
                  }}
                  className={`p-2 rounded text-xs font-mono flex items-center justify-between transition-all ${
                    entry.changed
                      ? "bg-amber-50 border border-amber-200 text-amber-900 shadow-sm"
                      : "bg-gray-50 border border-gray-100 text-gray-700"
                  }`}
                >
                  <span className="font-semibold text-gray-800 truncate max-w-[45%]">
                    {entry.key}
                  </span>
                  <span className="text-gray-500 truncate max-w-[50%]">
                    {entry.value}
                  </span>
                  {entry.changed && (
                    <span className="ml-2 px-1.5 py-0.2 bg-amber-200 text-amber-800 text-[10px] rounded font-sans">
                      modified
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 text-center text-xs text-gray-400 bg-gray-50 rounded border border-dashed border-gray-200">
              No storage accessed at this step
            </div>
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
