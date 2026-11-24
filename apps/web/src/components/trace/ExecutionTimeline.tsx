"use client";

import { useState } from "react";

interface ExecutionTimelineProps {
  nodes: any[];
  resourceProfile?: {
    read_bytes: number;
    read_limit: number;
    write_bytes: number;
    write_limit: number;
  };
}

export function ExecutionTimeline({
  nodes,
  resourceProfile,
}: ExecutionTimelineProps) {
  const [active, setActive] = useState(0);

  const isApproachingReadLimit =
    resourceProfile &&
    resourceProfile.read_limit > 0 &&
    resourceProfile.read_bytes / resourceProfile.read_limit > 0.9;
  const isApproachingWriteLimit =
    resourceProfile &&
    resourceProfile.write_limit > 0 &&
    resourceProfile.write_bytes / resourceProfile.write_limit > 0.9;

  const last = nodes.length - 1;

  function handleKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    if (nodes.length === 0) return;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        e.preventDefault();
        setActive((a) => Math.min(a + 1, last));
        break;
      case "ArrowUp":
      case "ArrowLeft":
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(last);
        break;
    }
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900 p-6 shadow-xl text-slate-100">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">Execution Timeline</h2>
        {(isApproachingReadLimit || isApproachingWriteLimit) && (
          <span className="flex items-center rounded-full bg-red-950/50 px-3 py-1 text-xs font-medium text-red-400">
            <span className="mr-1">⚠️</span>
            Storage IO Warning (Approaching limit)
          </span>
        )}
      </div>

      {nodes.length > 0 ? (
        <ul
          role="listbox"
          aria-label="Execution trace nodes"
          aria-activedescendant={
            nodes[active] !== undefined
              ? `trace-node-${active}`
              : undefined
          }
          tabIndex={0}
          onKeyDown={handleKeyDown}
          className="space-y-2 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500/70 focus-visible:-outline-offset-2 rounded-lg"
        >
          {nodes.map((node, idx) => {
            const selected = idx === active;
            return (
              <li
                key={idx}
                id={`trace-node-${idx}`}
                role="option"
                aria-selected={selected}
                onClick={() => setActive(idx)}
                className={`cursor-pointer rounded p-3 transition-colors focus:outline-none ${
                  selected
                    ? "border border-violet-500 bg-violet-950/40"
                    : "border border-slate-800 bg-slate-900/60 hover:bg-slate-800/60"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <span className="font-mono text-xs text-slate-500">
                      #{idx}
                    </span>
                    <span className="font-mono text-sm">
                      {node.node?.event_type || "Unknown"}
                    </span>
                  </div>
                  <span className="text-xs text-slate-500">
                    Path: {node.path?.join(" → ") || "root"}
                  </span>
                </div>
                {node.node?.data && (
                  <pre className="mt-2 overflow-x-auto text-xs text-slate-300">
                    {JSON.stringify(node.node.data, null, 2)}
                  </pre>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="py-8 text-center text-slate-500">
          No trace nodes yet. Waiting for trace data...
        </p>
      )}
    </div>
  );
}

export default ExecutionTimeline;
