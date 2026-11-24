"use client";

import { useMemo, useRef, useState } from "react";
import { useBreakpointsStore, type Breakpoint } from "@/store/breakpoints";

function DragHandle() {
  return (
    <span
      aria-hidden="true"
      className="cursor-grab active:cursor-grabbing text-slate-600 hover:text-slate-300 select-none px-1"
      title="Drag to reorder"
    >
      ⠿
    </span>
  );
}

interface BreakpointRowProps {
  bp: Breakpoint;
  /** Flat index in the global breakpoints array (used for reorder). */
  flatIndex: number;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** Controlled externally so only one row is the drop target at a time. */
  dragOverId: string | null;
  onDragStart: (index: number, id: string) => void;
  onDragEnter: (index: number, id: string) => void;
  onDragEnd: () => void;
  onDrop: (index: number) => void;
}

function BreakpointRow({
  bp,
  flatIndex,
  onToggle,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  dragOverId,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onDrop,
}: BreakpointRowProps) {
  const isDropTarget = dragOverId === bp.id;

  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart(flatIndex, bp.id);
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        onDragEnter(flatIndex, bp.id);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragEnd={onDragEnd}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(flatIndex);
      }}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors ${
        isDropTarget
          ? "border-violet-500 bg-violet-950/40"
          : "border-slate-800 bg-slate-900/60"
      } ${bp.enabled ? "opacity-100" : "opacity-60"}`}
    >
      <DragHandle />

      <input
        type="checkbox"
        checked={bp.enabled}
        onChange={() => onToggle(bp.id)}
        aria-label={`Toggle breakpoint ${bp.label}`}
        className="h-4 w-4 accent-violet-500 rounded"
      />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-mono text-slate-200 truncate">{bp.label}</p>
        <p className="text-xs text-slate-500 truncate">
          {bp.contract} · {bp.function}()
        </p>
      </div>

      {/* Keyboard-accessible reorder controls (paired with drag handle) */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => onMoveUp(flatIndex)}
          disabled={!canMoveUp}
          aria-label={`Move ${bp.label} up`}
          className="btn-press p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => onMoveDown(flatIndex)}
          disabled={!canMoveDown}
          aria-label={`Move ${bp.label} down`}
          className="btn-press p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ↓
        </button>
      </div>

      <button
        type="button"
        onClick={() => onRemove(bp.id)}
        aria-label={`Remove breakpoint ${bp.label}`}
        className="btn-press p-1 rounded text-slate-500 hover:text-red-400 hover:bg-slate-800"
      >
        ✕
      </button>
    </li>
  );
}

function AddBreakpointForm() {
  const addBreakpoint = useBreakpointsStore((s) => s.addBreakpoint);
  const [contract, setContract] = useState("");
  const [fn, setFn] = useState("");
  const [label, setLabel] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!contract.trim() || !fn.trim()) return;
    addBreakpoint({
      contract: contract.trim(),
      function: fn.trim(),
      label: label.trim() || `${fn.trim()}`,
      enabled: true,
    });
    setContract("");
    setFn("");
    setLabel("");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap gap-2 items-end pt-3 border-t border-slate-800 mt-3"
    >
      <label className="flex-1 min-w-[120px]">
        <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
          Contract
        </span>
        <input
          value={contract}
          onChange={(e) => setContract(e.target.value)}
          placeholder="C…"
          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-violet-500"
        />
      </label>
      <label className="flex-1 min-w-[120px]">
        <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
          Function
        </span>
        <input
          value={fn}
          onChange={(e) => setFn(e.target.value)}
          placeholder="transfer"
          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-violet-500"
        />
      </label>
      <label className="flex-1 min-w-[140px]">
        <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">
          Label (optional)
        </span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="transfer — line 42"
          className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-violet-500"
        />
      </label>
      <button
        type="submit"
        disabled={!contract.trim() || !fn.trim()}
        className="btn-press bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        Add
      </button>
    </form>
  );
}

export default function BreakpointManager() {
  const {
    breakpoints,
    groupByContract,
    setGroupByContract,
    toggleBreakpoint,
    removeBreakpoint,
    reorderBreakpoints,
    toggleAll,
    clear,
  } = useBreakpointsStore();

  const dragFrom = useRef<number | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const allEnabled = breakpoints.length > 0 && breakpoints.every((b) => b.enabled);
  const noneEnabled = breakpoints.length > 0 && breakpoints.every((b) => !b.enabled);

  // Group breakpoints by contract while preserving insertion order within each group.
  const groups = useMemo(() => {
    const map = new Map<string, { bp: Breakpoint; flatIndex: number }[]>();
    breakpoints.forEach((bp, flatIndex) => {
      const list = map.get(bp.contract) ?? [];
      list.push({ bp, flatIndex });
      map.set(bp.contract, list);
    });
    return Array.from(map.entries());
  }, [breakpoints]);

  function handleDrop(toIndex: number) {
    const from = dragFrom.current;
    if (from !== null) {
      reorderBreakpoints(from, toIndex);
    }
    dragFrom.current = null;
    setDragOverId(null);
  }

  return (
    <section
      aria-label="Breakpoint manager"
      className="card-interactive bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl text-slate-100"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold tracking-tight text-violet-400">
          Breakpoints
          <span className="ml-2 text-xs font-mono text-slate-500">
            {breakpoints.length}
          </span>
        </h2>

        <div className="flex items-center gap-2">
          {/* Quick enable/disable-all toggle */}
          <button
            type="button"
            onClick={toggleAll}
            disabled={breakpoints.length === 0}
            className="btn-press text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-700 text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label={
              allEnabled
                ? "Disable all breakpoints"
                : noneEnabled
                  ? "Enable all breakpoints"
                  : "Toggle all breakpoints"
            }
          >
            {allEnabled ? "Disable all" : "Enable all"}
          </button>

          <button
            type="button"
            onClick={clear}
            disabled={breakpoints.length === 0}
            className="btn-press text-xs font-medium px-3 py-1.5 rounded-lg text-slate-500 hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label="Clear all breakpoints"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Group toggle */}
      <label className="flex items-center gap-2 mb-4 text-xs text-slate-400 select-none">
        <input
          type="checkbox"
          checked={groupByContract}
          onChange={(e) => setGroupByContract(e.target.checked)}
          className="h-3.5 w-3.5 accent-violet-500 rounded"
        />
        Group by contract
      </label>

      {breakpoints.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-8">
          No breakpoints set. Add one below to start debugging.
        </p>
      ) : groupByContract ? (
        <div className="space-y-4">
          {groups.map(([contract, items]) => (
            <div key={contract}>
              <h3 className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5 flex items-center gap-2">
                <span className="font-mono">{contract}</span>
                <span className="text-slate-600">·</span>
                <span className="text-slate-600">{items.length}</span>
              </h3>
              <ul className="space-y-1.5">
                {items.map(({ bp, flatIndex }) => (
                  <BreakpointRow
                    key={bp.id}
                    bp={bp}
                    flatIndex={flatIndex}
                    onToggle={toggleBreakpoint}
                    onRemove={removeBreakpoint}
                    onMoveUp={(i) => reorderBreakpoints(i, i - 1)}
                    onMoveDown={(i) => reorderBreakpoints(i, i + 1)}
                    canMoveUp={flatIndex > 0}
                    canMoveDown={flatIndex < breakpoints.length - 1}
                    dragOverId={dragOverId}
                    onDragStart={(index) => {
                      dragFrom.current = index;
                    }}
                    onDragEnter={(_index, id) => setDragOverId(id)}
                    onDragEnd={() => {
                      dragFrom.current = null;
                      setDragOverId(null);
                    }}
                    onDrop={handleDrop}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {breakpoints.map((bp, flatIndex) => (
            <BreakpointRow
              key={bp.id}
              bp={bp}
              flatIndex={flatIndex}
              onToggle={toggleBreakpoint}
              onRemove={removeBreakpoint}
              onMoveUp={(i) => reorderBreakpoints(i, i - 1)}
              onMoveDown={(i) => reorderBreakpoints(i, i + 1)}
              canMoveUp={flatIndex > 0}
              canMoveDown={flatIndex < breakpoints.length - 1}
              dragOverId={dragOverId}
              onDragStart={(index) => {
                dragFrom.current = index;
              }}
              onDragEnter={(_index, id) => setDragOverId(id)}
              onDragEnd={() => {
                dragFrom.current = null;
                setDragOverId(null);
              }}
              onDrop={handleDrop}
            />
          ))}
        </ul>
      )}

      <AddBreakpointForm />
    </section>
  );
}
