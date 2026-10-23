import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Network } from "@/lib/types";

interface NetworkState {
  network: Network;
  customRpcUrl: string;
  isValidating: boolean;
  setNetwork: (network: Network) => void;
  setCustomRpcUrl: (url: string) => void;
  setIsValidating: (isValidating: boolean) => void;
}

export const useNetworkStore = create<NetworkState>()(
  persist(
    (set) => ({
      network: "testnet",
      customRpcUrl: "",
      isValidating: false,
      setNetwork: (network) => set({ network }),
      setCustomRpcUrl: (url) => set({ customRpcUrl: url }),
      setIsValidating: (isValidating) => set({ isValidating }),
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
