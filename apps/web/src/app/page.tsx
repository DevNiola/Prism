import Link from "next/link";
import RecentTransactions from "@/components/shared/RecentTransactions";

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-start px-4 py-16 gap-12">
      {/* Hero */}
      <section className="text-center max-w-2xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-950/40 border border-violet-800/40 text-violet-300 text-xs font-medium mb-6">
          <span>🔬</span> Soroban Transaction Debugger
        </div>
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight bg-gradient-to-r from-slate-100 via-violet-200 to-violet-400 bg-clip-text text-transparent mb-4">
          Prism
        </h1>
        <p className="text-slate-400 text-base md:text-lg mb-8">
          From cryptic error to root cause in one command. Decode, trace, and
          debug Soroban transactions.
        </p>
        <Link
          href="/decode"
          className="btn-press inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white font-semibold px-8 py-3 rounded-xl transition-colors shadow-lg shadow-violet-900/30"
        >
          🔍 Decode a Transaction
        </Link>
      </section>

      {/* Recent Transactions History */}
      <RecentTransactions />
    </main>
  );
}
