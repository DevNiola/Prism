"use client";

import { useState } from "react";
import { useNetworkStore } from "@/store/network";
import type { Network } from "@/lib/types";
import { getHealth } from "@/lib/api";

export default function NetworkSwitcher() {
  const { network, isValidating, setNetwork, setIsValidating } =
    useNetworkStore();
  const [toast, setToast] = useState<{
    message: string;
    type: "error" | "success";
  } | null>(null);

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
    } catch (error) {
      // Roll back to previous network on failure
      setNetwork(previousNetwork);
      setIsValidating(false);

      // Show error toast
      setToast({
        message: `Failed to switch to ${newNetwork}. Network unavailable.`,
        type: "error",
      });

      // Auto-dismiss toast after 3 seconds
      setTimeout(() => setToast(null), 3000);
    }
  };

  return (
    <div className="relative">
      <select
        value={network}
        onChange={handleNetworkChange}
        disabled={isValidating}
        className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm transition-colors hover:border-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
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

      {toast && (
        <div
          className={`fixed right-4 top-4 z-50 rounded-lg border px-4 py-3 shadow-lg ${
            toast.type === "error"
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-green-200 bg-green-50 text-green-800"
          }`}
        >
          <div className="flex items-center gap-2">
            {toast.type === "error" ? (
              <svg
                className="h-5 w-5"
                fill="currentColor"
                viewBox="0 0 20 20"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
            ) : (
              <svg
                className="h-5 w-5"
                fill="currentColor"
                viewBox="0 0 20 20"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
            )}
            <span className="text-sm font-medium">{toast.message}</span>
          </div>
        </div>
      )}
    </div>
  );
}
