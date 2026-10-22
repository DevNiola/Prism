import { create } from "zustand";
import type { Network } from "@/lib/types";

interface NetworkState {
  network: Network;
  customRpcUrl: string;
  isValidating: boolean;
  setNetwork: (network: Network) => void;
  setCustomRpcUrl: (url: string) => void;
  setIsValidating: (isValidating: boolean) => void;
}

export const useNetworkStore = create<NetworkState>((set) => ({
  network: "testnet",
  customRpcUrl: "",
  isValidating: false,
  setNetwork: (network) => set({ network }),
  setCustomRpcUrl: (url) => set({ customRpcUrl: url }),
  setIsValidating: (isValidating) => set({ isValidating }),
}));
