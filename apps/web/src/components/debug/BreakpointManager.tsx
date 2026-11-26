"use client";

import { useRef, useState } from "react";
import { useFocusRestore } from "@/hooks/useFocusRestore";

interface Breakpoint {
  id: string;
  /** Function name or `*` for any function */
  functionName: string;
  /** Optional contract ID prefix */
  contractId: string;
  /** Optional condition expression, e.g. "amount > 100" */
  condition: string;
  enabled: boolean;
}

function makeId() {
  return Math.random().toString(36).slice(2, 9);
}

export default function BreakpointManager() {
  const [open, setOpen] = useState(false);
  const [breakpoints, setBreakpoints] = useState<Breakpoint[]>([]);
  const [fnInput, setFnInput] = useState("");
  const [contractInput, setContractInput] = useState("");
  const [conditionInput, setConditionInput] = useState("");
  const [editingConditionId, setEditingConditionId] = useState<string | null>(null);
  const [editingConditionValue, setEditingConditionValue] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  useFocusRestore(open, panelRef);

  function handleClose() {
    setOpen(false);
    setEditingConditionId(null);
  }

  function addBreakpoint() {
    const fn_ = fnInput.trim();
    if (!fn_) return;
    const contract = contractInput.trim();
    const condition = conditionInput.trim();
    const key = `${contract}:${fn_}`;
    if (breakpoints.some((b) => `${b.contractId}:${b.functionName}` === key)) return;
    setBreakpoints((prev) => [
      ...prev,
      { id: makeId(), functionName: fn_, contractId: contract, condition, enabled: true },
    ]);
    setFnInput("");
    setContractInput("");
    setConditionInput("");
  }

  function removeBreakpoint(id: string) {
    setBreakpoints((prev) => prev.filter((b) => b.id !== id));
  }

  function toggleBreakpoint(id: string) {
    setBreakpoints((prev) =>
      prev.map((b) => (b.id === id ? { ...b, enabled: !b.enabled } : b)),
    );
  }

  function startEditCondition(bp: Breakpoint) {
    setEditingConditionId(bp.id);
    setEditingConditionValue(bp.condition);
  }

  function saveCondition(id: string) {
    setBreakpoints((prev) =>
      prev.map((b) =>
        b.id === id ? { ...b, condition: editingConditionValue.trim() } : b,
      ),
    );
    setEditingConditionId(null);
  }

  function displayLabel(bp: Breakpoint) {
    const prefix = bp.contractId ? `${bp.contractId}:` : "";
    return `${prefix}${bp.functionName}`;
  }

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

            {/* Add breakpoint form */}
            <div className="space-y-2 mb-4">
              <div className="flex gap-2">
                <input
                  value={fnInput}
                  onChange={(e) => setFnInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addBreakpoint();
                    }
                  }}
                  placeholder="function name (or * for all)"
                  aria-label="Function name"
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
              <input
                value={contractInput}
                onChange={(e) => setContractInput(e.target.value)}
                placeholder="contract ID (optional)"
                aria-label="Contract ID"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <input
                value={conditionInput}
                onChange={(e) => setConditionInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addBreakpoint();
                  }
                }}
                placeholder="condition expression (optional) — e.g. amount > 100"
                aria-label="Condition expression"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              />
            </div>

            {/* Breakpoint list */}
            <ul className="space-y-2 max-h-64 overflow-auto">
              {breakpoints.length === 0 && (
                <li className="text-sm text-gray-500">No breakpoints set.</li>
              )}
              {breakpoints.map((bp) => (
                <li
                  key={bp.id}
                  className={`border rounded-lg px-3 py-2 space-y-1 ${
                    bp.enabled ? "border-gray-200" : "border-gray-100 opacity-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={bp.enabled}
                        onChange={() => toggleBreakpoint(bp.id)}
                        aria-label={`Toggle breakpoint ${displayLabel(bp)}`}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600"
                      />
                      <span className="font-mono text-sm truncate">{displayLabel(bp)}</span>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => startEditCondition(bp)}
                        className="text-xs text-blue-600 hover:text-blue-700"
                      >
                        {bp.condition ? "Edit condition" : "Add condition"}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeBreakpoint(bp.id)}
                        className="text-xs text-red-600 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {/* Inline condition display / edit */}
                  {editingConditionId === bp.id ? (
                    <div className="flex gap-2 mt-1">
                      <input
                        autoFocus
                        value={editingConditionValue}
                        onChange={(e) => setEditingConditionValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            saveCondition(bp.id);
                          } else if (e.key === "Escape") {
                            setEditingConditionId(null);
                          }
                        }}
                        placeholder="e.g. amount > 100"
                        aria-label="Edit condition"
                        className="flex-1 border border-blue-400 rounded px-2 py-1 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => saveCondition(bp.id)}
                        className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingConditionId(null)}
                        className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    bp.condition && (
                      <p className="text-xs text-gray-500 font-mono pl-6">
                        when: {bp.condition}
                      </p>
                    )
                  )}
                </li>
              ))}
            </ul>

            <div className="flex justify-end mt-4">
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
