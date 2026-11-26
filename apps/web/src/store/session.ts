import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DiagnosticReport } from "@/lib/types";
import type { Network } from "@/lib/types";

export interface HistoryEntry {
  id: string;
  txHash: string;
  network: Network;
  timestamp: number;
  errorName: string;
  errorCategory: string;
  report: DiagnosticReport;
  pinned?: boolean;
}

export type FixDifficultyFilter = "all" | "easy" | "medium" | "hard";

interface SessionState {
  hasHydrated: boolean;
  txHash: string | null;
  report: DiagnosticReport | null;
  history: HistoryEntry[];
  fixDifficultyFilter: FixDifficultyFilter;
  setHasHydrated: (hasHydrated: boolean) => void;
  setTxHash: (hash: string) => void;
  setReport: (report: DiagnosticReport) => void;
  addToHistory: (
    txHash: string,
    network: Network,
    report: DiagnosticReport
  ) => void;
  togglePin: (id: string) => void;
  removeFromHistory: (id: string) => void;
  clearHistory: () => void;
  clear: () => void;
  setFixDifficultyFilter: (filter: FixDifficultyFilter) => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      hasHydrated: false,
      txHash: null,
      report: null,
      history: [],
      fixDifficultyFilter: "all" as FixDifficultyFilter,
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),

      setTxHash: (hash) => set({ txHash: hash }),

      setReport: (report) => set({ report }),

      addToHistory: (txHash, network, report) =>
        set((state) => {
          const entry: HistoryEntry = {
            id: `${txHash}-${Date.now()}`,
            txHash,
            network,
            timestamp: Date.now(),
            errorName: report.error_name,
            errorCategory: report.error_category,
            report,
            pinned: false,
          };

          // Deduplicate by txHash — keep the newest occurrence, then limit to 10
          const filtered = state.history.filter((h) => h.txHash !== txHash);
          const updated = [entry, ...filtered].slice(0, 10);

          return { history: updated };
        }),

      togglePin: (id) =>
        set((state) => ({
          history: state.history.map((h) =>
            h.id === id ? { ...h, pinned: !h.pinned } : h
          ),
        })),

      removeFromHistory: (id) =>
        set((state) => ({
          history: state.history.filter((h) => h.id !== id),
        })),

      clearHistory: () => set({ history: [] }),

      clear: () => set({ txHash: null, report: null }),

      setFixDifficultyFilter: (filter) => set({ fixDifficultyFilter: filter }),
    }),
    {
      name: "prism-session",
      // Persist history and fix difficulty filter to localStorage; keep active session in memory
      partialize: (state) => ({
        history: state.history,
        fixDifficultyFilter: state.fixDifficultyFilter,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
