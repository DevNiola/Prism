"use client";

import { useState } from "react";
import { useSessionStore, type HistoryEntry } from "@/store/session";
import { useToast } from "@/hooks/useToast";
import { useRouter } from "next/navigation";

function truncateHash(hash: string, chars = 8): string {
  if (hash.length <= chars * 2 + 3) return hash;
  return `${hash.slice(0, chars)}...${hash.slice(-chars)}`;
}

function formatTimestamp(ts: number): string {
  const now = Date.now();
  const diffMs = now - ts;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${diffDay}d ago`;
}

function NetworkBadge({ network }: { network: string }) {
  const styles: Record<string, string> = {
    mainnet: "bg-emerald-950/50 border-emerald-800/40 text-emerald-400",
    testnet: "bg-amber-950/50 border-amber-800/40 text-amber-400",
    futurenet: "bg-violet-950/50 border-violet-800/40 text-violet-400",
    custom: "bg-slate-800/60 border-slate-700/40 text-slate-400",
  };
  const cls =
    styles[network] ?? "bg-slate-800/60 border-slate-700/40 text-slate-400";
  return (
    <span
      className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${cls}`}
    >
      {network}
    </span>
  );
}

interface TransactionRowProps {
  entry: HistoryEntry;
  onSelect: (entry: HistoryEntry) => void;
  onTogglePin: (id: string) => void;
  onRemove: (id: string) => void;
}

function TransactionRow({
  entry,
  onSelect,
  onTogglePin,
  onRemove,
}: TransactionRowProps) {
  return (
    <li className="group/row flex items-stretch gap-2">
      {/* Pin button */}
      <button
        type="button"
        onClick={() => onTogglePin(entry.id)}
        aria-label={entry.pinned ? "Unpin transaction" : "Pin transaction"}
        title={entry.pinned ? "Unpin" : "Pin"}
        className={`shrink-0 flex items-center justify-center w-8 rounded-lg border transition-colors ${
          entry.pinned
            ? "border-violet-700/60 bg-violet-900/30 text-violet-400 hover:bg-violet-900/50"
            : "border-slate-800 bg-slate-900/60 text-slate-600 hover:text-violet-400 hover:border-violet-700/40"
        }`}
      >
        <span aria-hidden="true" className="text-sm leading-none">
          {entry.pinned ? "★" : "☆"}
        </span>
      </button>

      {/* Main row button */}
      <button
        onClick={() => onSelect(entry)}
        className="btn-press flex-1 text-left px-4 py-3 rounded-lg bg-slate-900/60 border border-slate-800 hover:border-violet-700/50 hover:bg-slate-800/60 transition-colors group min-w-0"
      >
        <div className="flex items-center justify-between gap-3">
          {/* Hash + network */}
          <div className="flex items-center gap-2 min-w-0">
            {entry.pinned && (
              <span className="text-violet-500 text-xs" aria-hidden="true">
                ★
              </span>
            )}
            <span className="text-violet-400 text-sm" aria-hidden="true">
              ⬡
            </span>
            <span className="font-mono text-sm text-slate-200 truncate group-hover:text-violet-300 transition-colors">
              {truncateHash(entry.txHash)}
            </span>
            <NetworkBadge network={entry.network} />
          </div>

          {/* Error name + timestamp */}
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs text-red-400 font-medium hidden sm:block">
              {entry.errorName}
            </span>
            <span className="text-xs text-slate-500">
              {formatTimestamp(entry.timestamp)}
            </span>
          </div>
        </div>

        {/* Error name on mobile */}
        <p className="text-xs text-slate-500 mt-1 sm:hidden">{entry.errorName}</p>
      </button>

      {/* Delete button */}
      <button
        type="button"
        onClick={() => onRemove(entry.id)}
        aria-label="Remove transaction from history"
        title="Remove"
        className="shrink-0 flex items-center justify-center w-8 rounded-lg border border-slate-800 bg-slate-900/60 text-slate-600 hover:text-red-400 hover:border-red-900/50 transition-colors opacity-0 group-hover/row:opacity-100 focus:opacity-100"
      >
        <span aria-hidden="true" className="text-sm leading-none">
          ✕
        </span>
      </button>
    </li>
  );
}

export default function RecentTransactions() {
  const { history, togglePin, removeFromHistory, clearHistory } =
    useSessionStore();
  const { showToast } = useToast();
  const router = useRouter();
  const [confirmingClear, setConfirmingClear] = useState(false);

  if (history.length === 0) return null;

  // Pinned entries float to the top; within each group, newest first.
  const sorted = [...history].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return b.timestamp - a.timestamp;
  });

  function handleSelect(entry: HistoryEntry) {
    router.push(`/decode?txHash=${encodeURIComponent(entry.txHash)}`);
  }

  function handleRemove(id: string) {
    removeFromHistory(id);
    showToast("Transaction removed from history.", "info");
  }

  function handleClearRequest() {
    setConfirmingClear(true);
  }

  function handleClearConfirm() {
    clearHistory();
    setConfirmingClear(false);
    showToast("History cleared.", "info");
  }

  function handleClearCancel() {
    setConfirmingClear(false);
  }

  return (
    <section className="max-w-3xl mx-auto w-full px-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
          Recent Transactions
        </h2>

        {confirmingClear ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400">Clear all history?</span>
            <button
              onClick={handleClearConfirm}
              className="btn-press text-red-400 hover:text-red-300 font-medium transition-colors"
            >
              Confirm
            </button>
            <button
              onClick={handleClearCancel}
              className="btn-press text-slate-500 hover:text-slate-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={handleClearRequest}
            className="btn-press text-xs text-slate-600 hover:text-red-400 transition-colors"
          >
            Clear history
          </button>
        )}
      </div>

      <ul className="space-y-2">
        {sorted.map((entry) => (
          <TransactionRow
            key={entry.id}
            entry={entry}
            onSelect={handleSelect}
            onTogglePin={togglePin}
            onRemove={handleRemove}
          />
        ))}
      </ul>
    </section>
  );
}
