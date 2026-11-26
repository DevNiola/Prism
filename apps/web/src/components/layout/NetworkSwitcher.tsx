"use client";

import { useEffect, useRef, useState } from "react";
import { useNetworkStore, type RpcStatus } from "@/store/network";
import type { Network } from "@/lib/types";
import { getHealth } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

const PING_INTERVAL_MS = 30_000;

const NETWORK_OPTIONS: { value: Network; label: string }[] = [
  { value: "testnet", label: "Testnet" },
  { value: "mainnet", label: "Mainnet" },
  { value: "futurenet", label: "Futurenet" },
];

const STATUS_DOT: Record<RpcStatus, string> = {
  unknown: "bg-gray-400",
  ok: "bg-green-400",
  degraded: "bg-amber-400",
  unreachable: "bg-red-500",
};

const STATUS_LABEL: Record<RpcStatus, string> = {
  unknown: "Checking…",
  ok: "Reachable",
  degraded: "High latency",
  unreachable: "Unreachable",
};

async function pingRpc(): Promise<{ status: RpcStatus; latencyMs: number }> {
  const start = performance.now();
  try {
    const res = await getHealth();
    const latencyMs = Math.round(performance.now() - start);
    if (latencyMs > 1500) return { status: "degraded", latencyMs };
    return { status: "ok", latencyMs };
  } catch {
    return { status: "unreachable", latencyMs: -1 };
  }
}

function formatChecked(ts: number | null): string {
  if (ts === null) return "Never";
  const diff = Math.round((Date.now() - ts) / 1000);
  if (diff < 5) return "Just now";
  if (diff < 60) return `${diff}s ago`;
  return `${Math.round(diff / 60)}m ago`;
}

export default function NetworkSwitcher() {
  const {
    network,
    isValidating,
    rpcStatus,
    rpcLatencyMs,
    rpcLastChecked,
    setNetwork,
    setIsValidating,
    setRpcHealth,
  } = useNetworkStore();
  const { showToast } = useToast();

  const [tooltipVisible, setTooltipVisible] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function runPing() {
    const result = await pingRpc();
    setRpcHealth(result.status, result.latencyMs >= 0 ? result.latencyMs : null);
  }

  useEffect(() => {
    runPing();
    intervalRef.current = setInterval(runPing, PING_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network]);

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
      {/* RPC status indicator */}
      <div
        className="relative flex items-center"
        onMouseEnter={() => setTooltipVisible(true)}
        onMouseLeave={() => setTooltipVisible(false)}
        onFocus={() => setTooltipVisible(true)}
        onBlur={() => setTooltipVisible(false)}
      >
        <span
          aria-label={`RPC status: ${STATUS_LABEL[rpcStatus]}`}
          className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_DOT[rpcStatus]} ${
            rpcStatus === "ok" ? "shadow-[0_0_6px_1px] shadow-green-400/60" : ""
          }`}
        />

        {tooltipVisible && (
          <div
            role="tooltip"
            className="absolute left-1/2 top-5 z-50 -translate-x-1/2 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 shadow-xl"
          >
            <p className="font-medium">{STATUS_LABEL[rpcStatus]}</p>
            {rpcLatencyMs !== null && rpcLatencyMs >= 0 && (
              <p className="text-slate-400">Latency: {rpcLatencyMs} ms</p>
            )}
            <p className="text-slate-500">
              Checked: {formatChecked(rpcLastChecked)}
            </p>
          </div>
        )}
      </div>

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
        {NETWORK_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
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
