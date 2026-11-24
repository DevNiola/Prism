import { create } from "zustand";
import type { Network } from "@/lib/types";

export type RpcStatus = "unknown" | "ok" | "degraded" | "unreachable";

interface NetworkState {
  network: Network;
  customRpcUrl: string;
  rpcStatus: RpcStatus;
  rpcLatencyMs: number | null;
  rpcLastChecked: number | null;
  setNetwork: (network: Network) => void;
  setCustomRpcUrl: (url: string) => void;
  setRpcHealth: (status: RpcStatus, latencyMs: number | null) => void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  network: "testnet",
  customRpcUrl: "",
  rpcStatus: "unknown",
  rpcLatencyMs: null,
  rpcLastChecked: null,
  setNetwork: (network) => set({ network, rpcStatus: "unknown", rpcLatencyMs: null, rpcLastChecked: null }),
  setCustomRpcUrl: (url) => set({ customRpcUrl: url }),
  setRpcHealth: (status, latencyMs) =>
    set({ rpcStatus: status, rpcLatencyMs: latencyMs, rpcLastChecked: Date.now() }),
}));
