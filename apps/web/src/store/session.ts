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
}

interface SessionState {
  hasHydrated: boolean;
  txHash: string | null;
  report: DiagnosticReport | null;
  history: HistoryEntry[];
  setHasHydrated: (hasHydrated: boolean) => void;
  setTxHash: (hash: string) => void;
  setReport: (report: DiagnosticReport) => void;
  addToHistory: (
    txHash: string,
    network: Network,
    report: DiagnosticReport
  ) => void;
  clearHistory: () => void;
  clear: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      hasHydrated: false,
      txHash: null,
      report: null,
      history: [],
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
          };

          // Deduplicate by txHash — keep the newest occurrence, then limit to 10
          const filtered = state.history.filter((h) => h.txHash !== txHash);
          const updated = [entry, ...filtered].slice(0, 10);

          return { history: updated };
        }),

      clearHistory: () => set({ history: [] }),

      clear: () => set({ txHash: null, report: null }),
    }),
    {
      name: "prism-session",
      // Only persist history to localStorage; keep active session in memory
      partialize: (state) => ({ history: state.history }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
