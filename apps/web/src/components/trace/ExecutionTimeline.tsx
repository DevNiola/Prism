"use client";

import React, { useEffect, useRef, useState } from "react";
import StepControls from "@/components/debug/StepControls";
import Skeleton from "@/components/shared/Skeleton";

interface ExecutionTimelineProps {
  nodes: any[];
  currentStep?: number;
  transitionDurationMs?: number;
  onSelectStep?: (index: number) => void;
  resourceProfile?: {
    read_bytes: number;
    read_limit: number;
    write_bytes: number;
    write_limit: number;
  };
  loading?: boolean;
}

const TIMELINE_ROWS = 3;

/**
 * Placeholder mirroring the height of a short timeline so the card does not
 * resize when the first trace nodes arrive.
 */
export function ExecutionTimelineSkeleton() {
  return (
    <div className="bg-white rounded-lg shadow p-6" aria-busy="true">
      <h2 className="text-xl font-semibold mb-4">Execution Timeline</h2>
      <div className="space-y-2">
        {Array.from({ length: TIMELINE_ROWS }, (_, index) => (
          <div key={index} className="p-3 border border-gray-200 rounded">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Skeleton className="h-4 w-8" />
                <Skeleton className="h-4 w-24" />
              </div>
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ExecutionTimeline({
  nodes,
  currentStep: controlledStep,
  transitionDurationMs = 200,
  onSelectStep,
  resourceProfile,
  loading,
}: ExecutionTimelineProps) {
  const [selectedStep, setSelectedStep] = useState(0);
  const timelineRef = useRef<HTMLDivElement>(null);
  const lastStep = nodes.length - 1;
  const currentStep = Math.min(controlledStep ?? selectedStep, Math.max(lastStep, 0));

  const selectStep = (step: number) => {
    if (controlledStep === undefined) setSelectedStep(step);
    onSelectStep?.(step);
  };

  const depth = nodes[currentStep]?.path?.length ?? 0;
  const over = nodes.findIndex((node, index) => index > currentStep && (node.path?.length ?? 0) <= depth);
  const out = nodes.findIndex((node, index) => index > currentStep && (node.path?.length ?? 0) < depth);

  const activeItemRef = useRef<HTMLDivElement | null>(null);
  // On small screens the user can switch which pane is visible
  const [activePane, setActivePane] = useState<"timeline" | "detail">(
    "timeline",
  );

  // Smooth scroll to keep current step visible in timeline
  useEffect(() => {
    if (activeItemRef.current && typeof activeItemRef.current.scrollIntoView === "function") {
      activeItemRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [currentStep]);

  if (loading && nodes.length === 0) {
    return <ExecutionTimelineSkeleton />;
  }

  const isApproachingReadLimit =
    resourceProfile &&
    resourceProfile.read_limit > 0 &&
    resourceProfile.read_bytes / resourceProfile.read_limit > 0.9;
  const isApproachingWriteLimit =
    resourceProfile &&
    resourceProfile.write_limit > 0 &&
    resourceProfile.write_bytes / resourceProfile.write_limit > 0.9;

  const activeNode = nodes[currentStep];

  return (
    <div ref={timelineRef} tabIndex={nodes.length ? 0 : undefined} className="bg-white rounded-lg shadow p-4 md:p-6 w-full overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <h2 className="text-xl font-semibold">Execution Timeline</h2>
        {(isApproachingReadLimit || isApproachingWriteLimit) && (
          <span className="px-3 py-1 bg-red-100 text-red-800 text-xs font-medium rounded-full flex items-center self-start sm:self-auto">
            <span className="mr-1">⚠️</span>
            Storage IO Warning (Approaching limit)
          </span>
        )}
      </div>

      {/* Step controls (keyboard shortcuts: Over / Into / Out / Continue) */}
      {nodes.length > 0 && (
        <div className="mb-4">
          <StepControls
            scopeRef={timelineRef}
            onStepOver={over >= 0 ? () => selectStep(over) : undefined}
            onStepInto={currentStep < lastStep ? () => selectStep(currentStep + 1) : undefined}
            onStepOut={out >= 0 ? () => selectStep(out) : undefined}
            onContinue={currentStep < lastStep ? () => selectStep(lastStep) : undefined}
          />
        </div>
      )}

      {/* Mobile pane switcher — hidden on sm+ where both panes show */}
      {nodes.length > 0 && (
        <div className="flex sm:hidden mb-3 rounded-md border border-gray-200 overflow-hidden text-xs font-medium">
          <button
            type="button"
            onClick={() => setActivePane("timeline")}
            className={`flex-1 py-2 transition-colors min-h-[44px] ${
              activePane === "timeline"
                ? "bg-purple-600 text-white"
                : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Timeline
          </button>
          <button
            type="button"
            onClick={() => setActivePane("detail")}
            className={`flex-1 py-2 transition-colors min-h-[44px] ${
              activePane === "detail"
                ? "bg-purple-600 text-white"
                : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Step Detail
          </button>
        </div>
      )}

      {/* Layout: on sm+ both panes show side by side; on mobile only one at a time */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Timeline list */}
        <div
          className={`${
            activePane === "timeline" ? "block" : "hidden"
          } sm:block sm:flex-1`}
        >
          {/* Scrollable container: visible scrollbar + drag-to-pan via overflow-x-auto */}
          <div
            className="space-y-2 max-h-[600px] overflow-y-auto overflow-x-auto pr-1 scroll-smooth"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            {nodes.map((node, idx) => {
              const isActive = idx === currentStep;
              return (
                <div
                  key={idx}
                  ref={isActive ? activeItemRef : null}
                  onClick={() => {
                    onSelectStep?.(idx);
                    setActivePane("detail");
                  }}
                  style={{ transitionDuration: `${transitionDurationMs}ms` }}
                  className={`min-w-[280px] p-3 border rounded cursor-pointer transition-all min-h-[44px] flex flex-col justify-center ${
                    isActive
                      ? "bg-purple-50 border-purple-500 shadow-sm translate-x-1 border-l-4 border-l-purple-600"
                      : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <div className="flex items-center space-x-3">
                      <span
                        className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                          isActive
                            ? "bg-purple-600 text-white font-bold"
                            : "text-gray-500 bg-gray-100"
                        }`}
                      >
                        #{idx}
                      </span>
                      <span className="font-mono text-sm font-medium">
                        {node.node?.event_type || "Unknown"}
                      </span>
                      {isActive && (
                        <span className="text-[10px] uppercase font-bold tracking-wider text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full animate-pulse">
                          Current Step
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-500 truncate max-w-[140px]">
                      {node.path?.join(" → ") || "root"}
                    </span>
                  </div>
                  {node.node?.data && (
                    <pre
                      className={`mt-2 text-xs overflow-x-auto transition-opacity ${
                        isActive ? "text-purple-900" : "text-gray-600"
                      }`}
                    >
                      {JSON.stringify(node.node.data, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Step detail panel — always visible on sm+, switchable on mobile */}
        {nodes.length > 0 && (
          <div
            className={`${
              activePane === "detail" ? "block" : "hidden"
            } sm:block sm:w-64 lg:w-80 shrink-0`}
          >
            <div className="rounded-lg border border-gray-200 p-4 bg-gray-50 h-full max-h-[600px] overflow-y-auto">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Step #{currentStep} Detail
              </div>
              {activeNode ? (
                <>
                  <div className="mb-2 text-sm font-medium text-gray-800">
                    {activeNode.node?.event_type || "Unknown"}
                  </div>
                  <div className="text-xs text-gray-500 mb-3">
                    Path: {activeNode.path?.join(" → ") || "root"}
                  </div>
                  {activeNode.node?.data && (
                    <pre className="text-xs bg-white rounded border p-3 overflow-x-auto whitespace-pre-wrap break-all">
                      {JSON.stringify(activeNode.node.data, null, 2)}
                    </pre>
                  )}
                </>
              ) : (
                <p className="text-xs text-gray-400">No data for this step.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {nodes.length === 0 && (
        <p className="text-gray-500 text-center py-8">
          No trace nodes yet. Waiting for trace data...
        </p>
      )}
    </div>
  );
}

export default ExecutionTimeline;
