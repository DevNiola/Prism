"use client";

import { useSessionStore, type HistoryEntry } from "@/store/session";
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
}

function TransactionRow({ entry, onSelect }: TransactionRowProps) {
  return (
    <li>
      <button
        onClick={() => onSelect(entry)}
        className="btn-press w-full text-left px-4 py-3 rounded-lg bg-slate-900/60 border border-slate-800 hover:border-violet-700/50 hover:bg-slate-800/60 transition-colors group"
      >
        <div className="flex items-center justify-between gap-3">
          {/* Hash + network */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-violet-400 text-sm">⬡</span>
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
    </li>
  );
}

export default function RecentTransactions() {
  const { history, clearHistory } = useSessionStore();
  const router = useRouter();

  if (history.length === 0) return null;

  function handleSelect(entry: HistoryEntry) {
    // Navigate to decode page — the selected report can be retrieved from history
    // via the tx hash stored in the URL query param
    router.push(`/decode?txHash=${encodeURIComponent(entry.txHash)}`);
  }

  return (
    <section className="max-w-3xl mx-auto w-full px-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
          Recent Transactions
        </h2>
        <button
          onClick={clearHistory}
          className="btn-press text-xs text-slate-600 hover:text-red-400 transition-colors"
        >
          Clear history
        </button>
      </div>

      <ul className="space-y-2">
        {history.map((entry) => (
          <TransactionRow key={entry.id} entry={entry} onSelect={handleSelect} />
        ))}
      </ul>
    </section>
  );
}
