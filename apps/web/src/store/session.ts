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

/**
 * Serializes transaction hash and network into URL search params for session sharing.
 */
export function serializeSessionToUrl(
  txHash: string,
  network: Network,
  baseUrl?: string
): string {
  const base =
    baseUrl ||
    (typeof window !== "undefined"
      ? window.location.href
      : "https://prism.stellar.org/decode");
  const url = new URL(base);
  url.searchParams.set("tx", txHash);
  url.searchParams.set("network", network);
  return url.toString();
}

/**
 * Parses shared session query params from a search string or URL.
 */
export function parseSessionFromUrl(searchOrUrl: string): {
  tx: string | null;
  network: Network | null;
} {
  try {
    const searchParams = searchOrUrl.startsWith("http")
      ? new URL(searchOrUrl).searchParams
      : new URLSearchParams(searchOrUrl);
    const tx = searchParams.get("tx") || searchParams.get("txHash");
    const network = (searchParams.get("network") as Network) || null;
    return { tx, network };
  } catch {
    return { tx: null, network: null };
  }
}
