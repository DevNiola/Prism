import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Network } from "@/lib/types";

export type RpcStatus = "unknown" | "ok" | "degraded" | "unreachable";

interface NetworkState {
  network: Network;
  customRpcUrl: string;
  isValidating: boolean;
  rpcStatus: RpcStatus;
  rpcLatencyMs: number | null;
  rpcLastChecked: number | null;
  setNetwork: (network: Network) => void;
  setCustomRpcUrl: (url: string) => void;
  setIsValidating: (isValidating: boolean) => void;
  setRpcHealth: (status: RpcStatus, latencyMs: number | null) => void;
}

export const useNetworkStore = create<NetworkState>()(
  persist(
    (set) => ({
      network: "testnet",
      customRpcUrl: "",
      isValidating: false,
      rpcStatus: "unknown" as RpcStatus,
      rpcLatencyMs: null,
      rpcLastChecked: null,
      setNetwork: (network) =>
        set({ network, rpcStatus: "unknown", rpcLatencyMs: null, rpcLastChecked: null }),
      setCustomRpcUrl: (url) => set({ customRpcUrl: url }),
      setIsValidating: (isValidating) => set({ isValidating }),
      setRpcHealth: (status, latencyMs) =>
        set({ rpcStatus: status, rpcLatencyMs: latencyMs, rpcLastChecked: Date.now() }),
    }),
    {
      name: "prism-network",
      partialize: (state) => ({
        network: state.network,
        customRpcUrl: state.customRpcUrl,
      }),
    }
  )
);
