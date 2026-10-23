"use client";

import { useEffect, useState } from "react";
import { useTrace } from "@/hooks/useTrace";
import { ExecutionTimeline } from "@/components/trace/ExecutionTimeline";
import { StateDiffViewer } from "@/components/trace/StateDiffViewer";
import { ResourceProfile } from "@/components/trace/ResourceProfile";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import Skeleton from "@/components/shared/Skeleton";
import EmptyState from "@/components/shared/EmptyState";

/** Mirrors the Transaction Info card so the page keeps its height while the
 *  trace stream is still being established. */
function TransactionInfoSkeleton() {
  return (
    <div className="bg-white rounded-lg shadow p-6" aria-busy="true">
      <h2 className="text-xl font-semibold mb-4">Transaction Info</h2>
      <dl className="grid grid-cols-2 gap-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index}>
            <dt className="text-sm text-gray-600">
              <Skeleton className="h-4 w-32" />
            </dt>
            <dd className="mt-1">
              <Skeleton className="h-4 w-40" />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function TracePage() {
  const [txHash, setTxHash] = useState("");
  const [network, setNetwork] = useState("testnet");

  const wsUrl =
    typeof window !== "undefined"
      ? `ws://${window.location.hostname}:8080`
      : "";

  const { trace, loading, requestTrace, streaming, streamError } =
    useTrace(wsUrl);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.search).get("txHash");
    if (hash) setTxHash(hash);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (txHash) {
      requestTrace(txHash, network);
    }
  };

  return (
    <main className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Execution Trace</h1>

      <form onSubmit={handleSubmit} className="mb-8 space-y-4">
        <div>
          <label htmlFor="txHash" className="block text-sm font-medium mb-2">
            Transaction Hash
          </label>
          <input
            id="txHash"
            type="text"
            value={txHash}
            onChange={(e) => setTxHash(e.target.value)}
            placeholder="Enter transaction hash..."
            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="network" className="block text-sm font-medium mb-2">
            Network
          </label>
          <select
            id="network"
            value={network}
            onChange={(e) => setNetwork(e.target.value)}
            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="testnet">Testnet</option>
            <option value="mainnet">Mainnet</option>
            <option value="futurenet">Futurenet</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={loading || !txHash}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Tracing..." : "Trace Transaction"}
        </button>

        {streaming && (
          <div className="text-sm text-green-600">
            ✓ Streaming enabled - trace will appear incrementally
          </div>
        )}

        {streamError && (
          <div className="text-sm text-red-600">
            ⚠ Streaming unavailable: {streamError}
          </div>
        )}
      </form>

      {loading && !trace && (
        <div className="space-y-8">
          <div className="flex items-center justify-center py-4">
            <LoadingSpinner label="Reconstructing state and starting replay" />
            <span className="ml-3 text-gray-600">
              Reconstructing state and starting replay...
            </span>
          </div>
          <TransactionInfoSkeleton />
          <ResourceProfile loading />
          <ExecutionTimeline nodes={[]} loading />
          <StateDiffViewer entries={[]} loading />
        </div>
      )}

      {!loading && !trace && (
        <EmptyState
          title="Your trace will appear here"
          description="Enter a transaction hash above and choose a network to start replaying its execution."
          illustration={
            <svg viewBox="0 0 160 112" className="h-28 w-40" fill="none">
              <path d="M28 24h92a8 8 0 0 1 8 8v48a8 8 0 0 1-8 8H28a8 8 0 0 1-8-8V32a8 8 0 0 1 8-8Z" stroke="currentColor" strokeWidth="2" />
              <path d="M45 42h34M45 56h58M45 70h42" stroke="currentColor" strokeLinecap="round" strokeWidth="2" opacity=".4" />
              <circle cx="112" cy="42" r="5" fill="#60a5fa" />
              <circle cx="91" cy="56" r="5" fill="#34d399" />
              <circle cx="78" cy="70" r="5" fill="#fbbf24" />
              <path d="M112 48v3a5 5 0 0 1-5 5h-11m-5 5v3a5 5 0 0 1-5 5h-3" stroke="#60a5fa" strokeWidth="2" strokeDasharray="3 3" />
            </svg>
          }
          action={
            <button
              type="button"
              onClick={() => document.getElementById("txHash")?.focus()}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Enter a transaction hash
            </button>
          }
        />
      )}

      {trace && (
        <div className="space-y-8">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Transaction Info</h2>
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-sm text-gray-600">Transaction Hash</dt>
                <dd className="font-mono text-sm">{trace.tx_hash}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-600">Ledger Sequence</dt>
                <dd className="font-mono text-sm">{trace.ledger_sequence}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-600">Trace Nodes</dt>
                <dd className="font-mono text-sm">
                  {trace.nodes.length}{" "}
                  {trace.completed ? "(complete)" : "(streaming...)"}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-600">State Changes</dt>
                <dd className="font-mono text-sm">{trace.state_diff.length}</dd>
              </div>
            </dl>

            {loading && (
              <div className="mt-4 flex items-center text-sm text-gray-600">
                <LoadingSpinner label="Streaming trace" className="mr-3" />
                <span>
                  {trace.nodes.length
                    ? `Processing trace nodes (${trace.nodes.length} received)...`
                    : "Waiting for the first trace node..."}
                </span>
              </div>
            )}

            {trace.error && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-800 font-medium">Error</p>
                <p className="text-red-600 text-sm mt-1">{trace.error}</p>
              </div>
            )}
          </div>

          <ResourceProfile profile={trace.resource_profile} loading={loading} />

          <ExecutionTimeline
            nodes={trace.nodes}
            resourceProfile={trace.resource_profile}
            loading={loading}
          />

          <StateDiffViewer entries={trace.state_diff} loading={loading} />
        </div>
      )}
    </main>
  );
}
