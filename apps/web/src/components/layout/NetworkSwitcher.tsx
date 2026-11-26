"use client";

import { useId, useState, type FormEvent } from "react";
import { useNetworkStore } from "@/store/network";
import type { Network } from "@/lib/types";
import { getHealth } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

export default function NetworkSwitcher() {
  const {
    network, customRpcUrl, savedCustomRpcUrls, isValidating,
    setNetwork, applyCustomRpcUrl, setIsValidating,
  } = useNetworkStore();
  const id = useId();
  const [editingCustom, setEditingCustom] = useState(false);
  const [draftUrl, setDraftUrl] = useState<string | null>(null);
  const [urlError, setUrlError] = useState("");
  const savedUrls = [...new Set([customRpcUrl, ...savedCustomRpcUrls].filter(Boolean))];
  const { showToast } = useToast();

  const handleNetworkChange = async (
    e: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const newNetwork = e.target.value as Network;
    setEditingCustom(newNetwork === "custom");
    setDraftUrl(null);
    setUrlError("");
    if (newNetwork === "custom") return;
    setIsValidating(true);

    try {
      // Validate network via a lightweight /health ping
      await getHealth();

      setNetwork(newNetwork);
    } catch {
      showToast(
        `Failed to switch to ${newNetwork}. Network unavailable.`,
        "error",
      );
    } finally {
      setIsValidating(false);
    }
  };

  function handleCustomRpcSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const url = new URL((draftUrl ?? customRpcUrl).trim());
      if (
        (url.protocol !== "https:" && url.protocol !== "http:") ||
        url.username || url.password || url.hash
      ) {
        throw new Error();
      }
      applyCustomRpcUrl(url.href);
      setEditingCustom(false);
      setDraftUrl(null);
      setUrlError("");
    } catch {
      setUrlError("Enter an HTTP or HTTPS RPC URL without credentials or a fragment.");
    }
  }

  return (
    <div className="relative flex flex-wrap items-center gap-2">
      <label
        htmlFor={`${id}-network`}
        className="text-sm font-medium text-slate-400 sr-only"
      >
        Select network
      </label>
      <select
        id={`${id}-network`}
        value={editingCustom ? "custom" : network}
        onChange={handleNetworkChange}
        disabled={isValidating}
        aria-label="Select Stellar network"
        className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="testnet">Testnet</option>
        <option value="mainnet">Mainnet</option>
        <option value="futurenet">Futurenet</option>
        <option value="custom">Custom RPC</option>
      </select>

      {(editingCustom || network === "custom") && (
        <form onSubmit={handleCustomRpcSubmit} noValidate className="flex flex-wrap gap-2">
          <label htmlFor={`${id}-rpc`} className="sr-only">Custom RPC URL</label>
          <input
            id={`${id}-rpc`}
            type="url"
            list={`${id}-saved-rpcs`}
            placeholder="https://rpc.example.com"
            value={draftUrl ?? customRpcUrl}
            onChange={(event) => {
              setDraftUrl(event.target.value);
              setUrlError("");
            }}
            aria-invalid={Boolean(urlError)}
            aria-describedby={urlError ? `${id}-rpc-error` : undefined}
            disabled={isValidating}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200"
          />
          <datalist id={`${id}-saved-rpcs`}>
            {savedUrls.map((url) => <option key={url} value={url} />)}
          </datalist>
          <button type="submit" disabled={isValidating} className="rounded-lg bg-violet-700 px-3 py-1.5 text-sm text-white">
            Apply RPC
          </button>
          {urlError && <p id={`${id}-rpc-error`} role="alert" className="w-full text-xs text-red-300">{urlError}</p>}
        </form>
      )}

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
