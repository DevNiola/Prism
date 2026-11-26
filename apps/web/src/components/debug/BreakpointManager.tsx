"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { useFocusRestore } from "@/hooks/useFocusRestore";
import { useToast } from "@/hooks/useToast";

/** Build a stable localStorage key from a contract id. */
function storageKey(contractId: string): string {
  return `prism:breakpoints:${contractId}`;
}

/** Load persisted breakpoints for a contract. Returns [] if none stored or on error. */
function loadPersistedBreakpoints(contractId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(contractId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as string[];
  } catch {
    // Ignore parse errors
  }
  return [];
}

/** Persist the breakpoints array for a contract. */
function saveBreakpoints(contractId: string, breakpoints: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(contractId), JSON.stringify(breakpoints));
  } catch {
    // Ignore quota / security errors
  }
}

export interface BreakpointManagerProps {
  /**
   * Decoded contract id used as part of the storage key.
   * Defaults to "__default__" when not provided (e.g. during development).
   */
  contractId?: string;
  /**
   * Optional list of valid function signatures in the current trace.
   * When provided, breakpoints whose value does not appear in this list are
   * dropped on mount (reconciliation).
   */
  traceNodes?: string[];
}

export default function BreakpointManager({
  contractId = "__default__",
  traceNodes,
}: BreakpointManagerProps) {
  const [open, setOpen] = useState(false);
  const [breakpoints, setBreakpoints] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Record the trigger that opened this dialog and restore focus to it on close
  useFocusRestore(open, panelRef);

  // On mount: load from localStorage and reconcile against traceNodes
  useEffect(() => {
    const persisted = loadPersistedBreakpoints(contractId);
    if (traceNodes && traceNodes.length > 0) {
      const valid = persisted.filter((bp) => traceNodes.includes(bp));
      setBreakpoints(valid);
      saveBreakpoints(contractId, valid);
    } else {
      setBreakpoints(persisted);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractId]);

  // Persist whenever breakpoints change
  useEffect(() => {
    saveBreakpoints(contractId, breakpoints);
  }, [contractId, breakpoints]);

  let toast: ReturnType<typeof useToast> | null = null;
  try {
    // useToast throws if there is no ToastProvider; guard so the component
    // still works in contexts without one.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    toast = useToast();
  } catch {
    toast = null;
  }

  function handleClose() {
    setOpen(false);
    setConfirmClear(false);
  }

  const addBreakpoint = useCallback(() => {
    const value = input.trim();
    if (!value) return;
    setBreakpoints((prev) =>
      prev.includes(value) ? prev : [...prev, value],
    );
    setInput("");
  }, [input]);

  const removeBreakpoint = useCallback((b: string) => {
    setBreakpoints((prev) => prev.filter((x) => x !== b));
  }, []);

  const handleClearAll = useCallback(() => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setBreakpoints([]);
    saveBreakpoints(contractId, []);
    setConfirmClear(false);
    toast?.showToast("All breakpoints cleared.", "info");
  }, [confirmClear, contractId, toast]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        Manage Breakpoints
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={handleClose}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Breakpoint Manager"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") handleClose();
            }}
            className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 outline-none"
          >
            <h3 className="text-lg font-semibold mb-3">Breakpoints</h3>

            <div className="flex gap-2 mb-4">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addBreakpoint();
                  }
                }}
                placeholder="function name or location"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <button
                type="button"
                onClick={addBreakpoint}
                className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Add
              </button>
            </div>

            <ul className="space-y-2 max-h-60 overflow-auto">
              {breakpoints.length === 0 && (
                <li className="text-sm text-gray-500">No breakpoints set.</li>
              )}
              {breakpoints.map((b) => (
                <li
                  key={b}
                  className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2"
                >
                  <span className="font-mono text-sm">{b}</span>
                  <button
                    type="button"
                    onClick={() => removeBreakpoint(b)}
                    className="text-sm text-red-600 hover:text-red-700"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>

            <div className="flex justify-between items-center mt-4">
              {breakpoints.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAll}
                  className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                    confirmClear
                      ? "bg-red-600 text-white hover:bg-red-700"
                      : "text-red-600 hover:bg-red-50"
                  }`}
                >
                  {confirmClear ? "Confirm clear all" : "Clear all"}
                </button>
              )}
              {!breakpoints.length && <span />}
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-sm rounded-lg hover:bg-gray-100"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
