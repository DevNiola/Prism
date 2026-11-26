import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Network } from "@/lib/types";

interface NetworkState {
  network: Network;
  customRpcUrl: string;
  savedCustomRpcUrls: string[];
  isValidating: boolean;
  setNetwork: (network: Network) => void;
  setCustomRpcUrl: (url: string) => void;
  applyCustomRpcUrl: (url: string) => void;
  setIsValidating: (isValidating: boolean) => void;
}

export const useNetworkStore = create<NetworkState>()(
  persist(
    (set) => ({
      network: "testnet",
      customRpcUrl: "",
      savedCustomRpcUrls: [],
      isValidating: false,
      setNetwork: (network) => set({ network }),
      setCustomRpcUrl: (url) => set({ customRpcUrl: url }),
      applyCustomRpcUrl: (url) => set((state) => ({
        network: "custom",
        customRpcUrl: url,
        savedCustomRpcUrls: [
          url,
          ...state.savedCustomRpcUrls.filter((savedUrl) => savedUrl !== url),
        ],
      })),
      setIsValidating: (isValidating) => set({ isValidating }),
    }),
    {
      name: "prism-network",
      partialize: (state) => ({
        network: state.network,
        customRpcUrl: state.customRpcUrl,
        savedCustomRpcUrls: state.savedCustomRpcUrls,
      }),
    }
  )
);
