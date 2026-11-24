"use client";

import { useState, Suspense } from "react";
import { useSessionUrl } from "@/hooks/useSessionUrl";
import {
  Header,
  Footer,
  DecodeForm,
  ErrorCard,
  ContractErrorView,
  ContextSummary,
} from "@/components";
import type { DiagnosticReport } from "@/lib/types";
import { useSessionStore } from "@/store/session";
import EmptyState from "@/components/shared/EmptyState";

function DecodePageContent() {
  const { txHash: txHashParam, network, explicitNetwork, view: activeTab, updateSessionUrl } =
    useSessionUrl("decode");
  const { addToHistory, history } = useSessionStore();
  const [localResult, setLocalResult] = useState<{
    txHash: string | null;
    network: typeof network;
    report: DiagnosticReport | null;
  } | null>(null);

  const cachedEntry = txHashParam
    ? history.find((entry) => entry.txHash === txHashParam &&
        (!explicitNetwork || entry.network === explicitNetwork))
    : undefined;
  const activeNetwork = cachedEntry?.network ?? network;
  const report = localResult?.txHash === txHashParam && localResult.network === activeNetwork
    ? localResult.report
    : cachedEntry?.report ?? null;

  function handleDecode(decoded: DiagnosticReport | null) {
    const txHash = decoded?.transaction_context?.tx_hash || txHashParam;
    setLocalResult({ txHash, network: activeNetwork, report: decoded });
    if (decoded) {
      const historyKey = txHash ??
        `${decoded.error_category.toLowerCase()}-${decoded.error_code}-${Date.now()}`;
      addToHistory(historyKey, activeNetwork, decoded);
      if (txHash) updateSessionUrl({ txHash, network: activeNetwork });
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-violet-500/30 selection:text-violet-200">
      <Header />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-8 md:py-12">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-950/40 border border-violet-800/40 text-violet-300 text-xs font-medium mb-4 animate-pulse">
            <span>🔬</span> Soroban Transaction Debugger
          </div>
          <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-slate-100 via-violet-200 to-violet-400 bg-clip-text text-transparent mb-4">
            Decode Transaction Errors
          </h1>
          <p className="text-slate-400 max-w-xl mx-auto text-base md:text-lg">
            Diagnose cryptic Soroban execution failures, map raw error codes,
            and find suggested remedies instantly.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex justify-center border-b border-slate-800 mb-8 max-w-md mx-auto">
          <button
            onClick={() => updateSessionUrl({ view: "diagnose", network: activeNetwork })}
            aria-selected={activeTab === "diagnose"}
            role="tab"
            className={`flex-1 pb-3 text-sm font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 border-b-2 ${
              activeTab === "diagnose"
                ? "text-violet-400 border-violet-500"
                : "text-slate-500 border-transparent hover:text-slate-300"
            }`}
          >
            🔍 Diagnose Error
          </button>
          <button
            onClick={() => updateSessionUrl({ view: "lookup", network: activeNetwork })}
            aria-selected={activeTab === "lookup"}
            role="tab"
            className={`flex-1 pb-3 text-sm font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 border-b-2 ${
              activeTab === "lookup"
                ? "text-violet-400 border-violet-500"
                : "text-slate-500 border-transparent hover:text-slate-300"
            }`}
          >
            📋 Contract Error Reference
          </button>
        </div>

        {/* Tab content */}
        <div className="transition-all duration-300">
          {activeTab === "diagnose" ? (
            <div className="space-y-6">
              <DecodeForm onDecode={handleDecode} />
              {!report && (
                <EmptyState
                  title="Ready to decode an error"
                  description="Choose an error category and enter its code above to see a diagnosis and suggested fixes."
                  illustration={
                    <svg viewBox="0 0 160 112" className="h-28 w-40" fill="none">
                      <path d="M34 82h57a9 9 0 0 0 9-9V31a9 9 0 0 0-9-9H44a9 9 0 0 0-9 9v51Z" stroke="currentColor" strokeWidth="2" />
                      <path d="M48 43h38M48 54h24M48 65h17" stroke="currentColor" strokeLinecap="round" strokeWidth="2" opacity=".45" />
                      <circle cx="105" cy="65" r="19" stroke="#a78bfa" strokeWidth="3" />
                      <path d="m119 79 13 13" stroke="#a78bfa" strokeLinecap="round" strokeWidth="4" />
                      <path d="m101 65 3 3 6-7" stroke="#a78bfa" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
                    </svg>
                  }
                  action={
                    <button
                      type="button"
                      onClick={() => document.getElementById("decode-error-code")?.focus()}
                      className="rounded-md border border-violet-500/50 px-4 py-2 text-sm font-medium text-violet-300 hover:bg-violet-500/10"
                    >
                      Enter an error code
                    </button>
                  }
                />
              )}
              {report && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <ErrorCard report={report} />
                  {report.transaction_context && (
                    <ContextSummary context={report.transaction_context} />
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <ContractErrorView />
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default function DecodePage() {
  return (
    <Suspense>
      <DecodePageContent />
    </Suspense>
  );
}
