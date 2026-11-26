import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DiagnosticReport } from "@/lib/types";
import type { Network } from "@/lib/types";

export type SessionView = "diagnose" | "lookup" | "trace";

export interface SessionLocation {
  txHash: string | null;
  network: Network;
  view: SessionView;
}

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

interface SessionState extends SessionLocation {
  hasHydrated: boolean;
  report: DiagnosticReport | null;
  history: HistoryEntry[];
  replayCancelIntent: { txHash: string; requestedAt: number } | null;
  recordReplayCancel: (txHash: string) => void;
  setHasHydrated: (hasHydrated: boolean) => void;
  setSessionLocation: (location: SessionLocation) => void;
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
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      hasHydrated: false,
      txHash: null,
      network: "testnet",
      view: "diagnose",
      setSessionLocation: (location) => set((state) => ({
        ...location,
        report: state.txHash === location.txHash && state.network === location.network
          ? state.report
          : null,
      })),
      report: null,
      history: [],
      replayCancelIntent: null,
      recordReplayCancel: (txHash) =>
        set({ replayCancelIntent: { txHash, requestedAt: Date.now() } }),
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

      clear: () => set({ txHash: null, report: null, replayCancelIntent: null }),
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
