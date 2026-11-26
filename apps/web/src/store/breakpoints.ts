import { create } from "zustand";

/**
 * A breakpoint scoped to a Soroban contract function. Breakpoints are stored
 * in a flat array (insertion order) so they can be reordered independently of
 * how they are displayed (grouped or flat).
 */
export interface Breakpoint {
  id: string;
  contract: string;
  function: string;
  label: string;
  enabled: boolean;
}

interface BreakpointsState {
  breakpoints: Breakpoint[];
  /** When true, the manager renders breakpoints grouped by contract. */
  groupByContract: boolean;
  addBreakpoint: (bp: Omit<Breakpoint, "id">) => void;
  removeBreakpoint: (id: string) => void;
  toggleBreakpoint: (id: string) => void;
  /** Move the breakpoint at flat index `from` to flat index `to`. */
  reorderBreakpoints: (from: number, to: number) => void;
  setGroupByContract: (v: boolean) => void;
  enableAll: () => void;
  disableAll: () => void;
  /** Toggle every breakpoint to the opposite of the current majority state. */
  toggleAll: () => void;
  clear: () => void;
}

/** Pure array move used by drag-to-reorder and keyboard reordering. */
function move<T>(arr: T[], from: number, to: number): T[] {
  if (from < 0 || from >= arr.length) return arr;
  if (to < 0 || to >= arr.length) return arr;
  if (from === to) return arr;
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `bp-${Date.now()}-${counter}`;
}

export const useBreakpointsStore = create<BreakpointsState>((set) => ({
  // Seed with a few representative breakpoints so drag-to-reorder and grouping
  // are demonstrable before the user adds their own. Not persisted.
  breakpoints: [
    {
      id: nextId(),
      contract: "CAZ5X…Q7N",
      function: "transfer",
      label: "transfer — line 42",
      enabled: true,
    },
    {
      id: nextId(),
      contract: "CAZ5X…Q7N",
      function: "approve",
      label: "approve — line 88",
      enabled: false,
    },
    {
      id: nextId(),
      contract: "C3K9M…2PR",
      function: "mint",
      label: "mint — line 12",
      enabled: true,
    },
  ],
  groupByContract: false,

  addBreakpoint: (bp) =>
    set((s) => ({
      breakpoints: [...s.breakpoints, { ...bp, id: nextId() }],
    })),

  removeBreakpoint: (id) =>
    set((s) => ({ breakpoints: s.breakpoints.filter((b) => b.id !== id) })),

  toggleBreakpoint: (id) =>
    set((s) => ({
      breakpoints: s.breakpoints.map((b) =>
        b.id === id ? { ...b, enabled: !b.enabled } : b,
      ),
    })),

  reorderBreakpoints: (from, to) =>
    set((s) => ({ breakpoints: move(s.breakpoints, from, to) })),

  setGroupByContract: (v) => set({ groupByContract: v }),

  enableAll: () =>
    set((s) => ({
      breakpoints: s.breakpoints.map((b) => ({ ...b, enabled: true })),
    })),

  disableAll: () =>
    set((s) => ({
      breakpoints: s.breakpoints.map((b) => ({ ...b, enabled: false })),
    })),

  toggleAll: () =>
    set((s) => {
      const allEnabled = s.breakpoints.every((b) => b.enabled);
      return {
        breakpoints: s.breakpoints.map((b) => ({
          ...b,
          enabled: !allEnabled,
        })),
      };
    }),

  clear: () => set({ breakpoints: [] }),
}));
