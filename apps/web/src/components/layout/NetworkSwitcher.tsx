"use client";

import { useNetworkStore } from "@/store/network";
import type { Network } from "@/lib/types";
import { getHealth } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

export default function NetworkSwitcher() {
  const { network, isValidating, setNetwork, setIsValidating } =
    useNetworkStore();
  const { showToast } = useToast();

  const handleNetworkChange = async (
    e: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const newNetwork = e.target.value as Network;
    const previousNetwork = network;

    // Optimistically update the network
    setNetwork(newNetwork);
    setIsValidating(true);

    try {
      // Validate network via a lightweight /health ping
      await getHealth();

      // Success - network is valid
      setIsValidating(false);
    } catch {
      // Roll back to previous network on failure
      setNetwork(previousNetwork);
      setIsValidating(false);

      showToast(
        `Failed to switch to ${newNetwork}. Network unavailable.`,
        "error",
      );
    }
  };

  return (
    <div className="relative flex items-center gap-2">
      <label
        htmlFor="network-select"
        className="text-sm font-medium text-slate-400 sr-only"
      >
        Select network
      </label>
      <select
        id="network-select"
        value={network}
        onChange={handleNetworkChange}
        disabled={isValidating}
        aria-label="Select Stellar network"
        className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="testnet">Testnet</option>
        <option value="mainnet">Mainnet</option>
        <option value="futurenet">Futurenet</option>
      </select>

      {isValidating && (
        <span className="ml-2 inline-flex items-center text-xs text-gray-500">
          <svg
            className="mr-1 h-3 w-3 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          Validating...
        </span>
      )}

    </div>
  );
}
