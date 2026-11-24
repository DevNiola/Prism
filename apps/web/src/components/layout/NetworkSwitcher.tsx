"use client";

import { useEffect, useRef, useState } from "react";
import { useNetworkStore, type RpcStatus } from "@/store/network";
import type { Network } from "@/lib/types";

const PING_INTERVAL_MS = 30_000;
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

const NETWORK_LABELS: Record<Network, string> = {
  mainnet: "Mainnet",
  testnet: "Testnet",
  futurenet: "Futurenet",
  custom: "Custom",
};

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
    const res = await fetch(`${API_BASE}/health`, { cache: "no-store" });
    const latencyMs = Math.round(performance.now() - start);
    if (!res.ok) return { status: "degraded", latencyMs };
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
  const { network, rpcStatus, rpcLatencyMs, rpcLastChecked, setNetwork, setRpcHealth } =
    useNetworkStore();

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

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setNetwork(e.target.value as Network);
  }

  const isUnreachable = rpcStatus === "unreachable";

  return (
    <div className="relative inline-flex items-center gap-2">
      {/* Status dot + tooltip */}
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
            className="absolute left-1/2 top-5 z-50 -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/10 bg-[#1a1d27] px-3 py-2 text-xs text-white shadow-xl"
          >
            <p className="font-medium">{STATUS_LABEL[rpcStatus]}</p>
            {rpcLatencyMs !== null && rpcLatencyMs >= 0 && (
              <p className="text-white/60">Latency: {rpcLatencyMs} ms</p>
            )}
            <p className="text-white/40">
              Checked: {formatChecked(rpcLastChecked)}
            </p>
          </div>
        )}
      </div>

      {/* Network selector */}
      <select
        value={network}
        onChange={handleChange}
        disabled={isUnreachable}
        aria-label="Select network"
        className="rounded border border-white/10 bg-[#0f1117] px-2 py-1 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {(Object.keys(NETWORK_LABELS) as Network[]).map((n) => (
          <option key={n} value={n}>
            {NETWORK_LABELS[n]}
          </option>
        ))}
      </select>

      {/* Unreachable warning */}
      {isUnreachable && (
        <span className="text-xs text-red-400">
          RPC unreachable — submit disabled
        </span>
      )}
    </div>
  );
}
