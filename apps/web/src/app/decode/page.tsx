"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
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
import { useNetworkStore } from "@/store/network";

function DecodePageContent() {
  const [activeTab, setActiveTab] = useState<"diagnose" | "lookup">("diagnose");
  const [report, setReport] = useState<DiagnosticReport | null>(null);

  const { addToHistory, history } = useSessionStore();
  const { network } = useNetworkStore();

  const searchParams = useSearchParams();
  const txHashParam = searchParams.get("txHash");

  // If the user navigated here from the history list, pre-load the last matching report
  useEffect(() => {
    if (txHashParam) {
      const entry = history.find((h) => h.txHash === txHashParam);
      if (entry) {
        setReport(entry.report);
      }
    }
    // Only run on initial mount / txHashParam change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txHashParam]);

  function handleDecode(decoded: DiagnosticReport | null) {
    setReport(decoded);
    if (decoded) {
      // Use the txHash from the URL param if present; otherwise generate a placeholder key
      const txHash =
        txHashParam ??
        `${decoded.error_category.toLowerCase()}-${decoded.error_code}-${Date.now()}`;
      addToHistory(txHash, network, decoded);
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
            onClick={() => setActiveTab("diagnose")}
            className={`flex-1 pb-3 text-sm font-semibold transition-all focus:outline-none border-b-2 ${
              activeTab === "diagnose"
                ? "text-violet-400 border-violet-500"
                : "text-slate-500 border-transparent hover:text-slate-300"
            }`}
          >
            🔍 Diagnose Error
          </button>
          <button
            onClick={() => setActiveTab("lookup")}
            className={`flex-1 pb-3 text-sm font-semibold transition-all focus:outline-none border-b-2 ${
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
