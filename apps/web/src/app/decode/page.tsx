"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Header,
  Footer,
  DecodeForm,
  ErrorCard,
  ErrorCardSkeleton,
  ContractErrorView,
  ContextSummary,
} from "@/components";
import type { DiagnosticReport, Network } from "@/lib/types";
import { useSessionStore } from "@/store/session";
import { useNetworkStore } from "@/store/network";
import EmptyState from "@/components/shared/EmptyState";

function DecodePageContent() {
  const [activeTab, setActiveTab] = useState<"diagnose" | "lookup">("diagnose");
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [optimisticReport, setOptimisticReport] = useState<DiagnosticReport | null>(null);
  const [shareCopied, setShareCopied] = useState<boolean>(false);

  const { addToHistory, history } = useSessionStore();
  const { network, setNetwork } = useNetworkStore();

  const searchParams = useSearchParams();
  const txHashParam = searchParams.get("tx") || searchParams.get("txHash");
  const networkParam = searchParams.get("network");

  // On mount / URL param change: sync network & restore session if present (Issue #23)
  useEffect(() => {
    if (networkParam && networkParam !== network) {
      setNetwork(networkParam as Network);
    }

    if (txHashParam) {
      const entry = history.find((h) => h.txHash === txHashParam);
      if (entry) {
        setReport(entry.report);
      }
    }
  }, [txHashParam, networkParam, network, history, setNetwork]);

  function handleOptimistic(placeholder: DiagnosticReport | null) {
    setOptimisticReport(placeholder);
  }

  function handleDecode(decoded: DiagnosticReport | null) {
    setOptimisticReport(null);
    setReport(decoded);
    if (decoded) {
      const txHash =
        txHashParam ??
        `${decoded.error_category.toLowerCase()}-${decoded.error_code}-${Date.now()}`;
      addToHistory(txHash, network, decoded);

      // Serialize tx and network into URL search params for session link sharing (Issue #23)
      if (typeof window !== "undefined") {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("tx", txHash);
        nextUrl.searchParams.set("network", network);
        window.history.replaceState({}, "", nextUrl.toString());
      }
    }
  }

  const handleShare = () => {
    if (typeof window !== "undefined") {
      const nextUrl = new URL(window.location.href);
      if (report) {
        const currentTx =
          report.transaction_context?.tx_hash || txHashParam || "session";
        nextUrl.searchParams.set("tx", currentTx);
        nextUrl.searchParams.set("network", network);
      }
      navigator.clipboard.writeText(nextUrl.toString());
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    }
  };

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
            onClick={() => setActiveTab("diagnose")}
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
            onClick={() => setActiveTab("lookup")}
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
              <DecodeForm onDecode={handleDecode} onOptimistic={handleOptimistic} />

              {/* Optimistic UI skeleton rendered while request is in flight */}
              {optimisticReport && !report && (
                <div className="animate-in fade-in duration-200">
                  <ErrorCardSkeleton
                    txHash={optimisticReport.transaction_context?.tx_hash ?? txHashParam ?? undefined}
                    indicatorText="Decoding in progress (<100ms feedback)..."
                  />
                </div>
              )}

              {!report && !optimisticReport && (
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
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleShare}
                      className="inline-flex items-center gap-2 rounded-lg border border-violet-500/40 bg-violet-950/40 px-3.5 py-1.5 text-xs font-semibold text-violet-300 hover:bg-violet-900/60 transition-colors shadow-sm"
                      title="Share session with query-param state"
                    >
                      <span>🔗</span>
                      <span>{shareCopied ? "Link Copied!" : "Share Session"}</span>
                    </button>
                  </div>
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
