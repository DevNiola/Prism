"use client";

import { useRef, useState } from "react";
import { useFocusRestore } from "@/hooks/useFocusRestore";

export default function BreakpointManager() {
  const [open, setOpen] = useState(false);
  const [breakpoints, setBreakpoints] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  // Record the trigger that opened this dialog and restore focus to it on close
  // (including when the user dismisses with Esc).
  useFocusRestore(open, panelRef);

  function handleClose() {
    setOpen(false);
  }

  function addBreakpoint() {
    const value = input.trim();
    if (!value) return;
    setBreakpoints((prev) =>
      prev.includes(value) ? prev : [...prev, value]
    );
    setInput("");
  }

  function removeBreakpoint(b: string) {
    setBreakpoints((prev) => prev.filter((x) => x !== b));
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
