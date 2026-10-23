import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Network } from "@/lib/types";

interface NetworkState {
  network: Network;
  customRpcUrl: string;
  setNetwork: (network: Network) => void;
  setCustomRpcUrl: (url: string) => void;
}

export const useNetworkStore = create<NetworkState>()(
  persist(
    (set) => ({
      network: "testnet",
      customRpcUrl: "",
      setNetwork: (network) => set({ network }),
      setCustomRpcUrl: (url) => set({ customRpcUrl: url }),
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
