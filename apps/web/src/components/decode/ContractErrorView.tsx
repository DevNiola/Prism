"use client";

import { useState, useEffect } from "react";
import contractTaxonomy from "../../lib/contract-taxonomy.json";
import { initWasm } from "@/lib/wasm";
import ErrorBoundary from "../shared/ErrorBoundary";
import { useNetworkStore } from "@/store/network";
import type { ContractErrorInfo, Network } from "@/lib/types";

function networkToExpertNetwork(network: Network): string {
  if (network === "custom") return "testnet";
  return network;
}

export function ContractErrorInfoPanel({ info }: { info: ContractErrorInfo }) {
  const { network } = useNetworkStore();
  const [copied, setCopied] = useState(false);

  const explorerUrl = `https://stellar.expert/explorer/${networkToExpertNetwork(network)}/contract/${info.contract_id}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(info.contract_id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const hasDetails = Boolean(info.error_name || info.doc_comment);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl max-w-3xl mx-auto my-4 text-slate-100">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-bold tracking-tight text-violet-400">
          Contract Error Info
        </h3>
        <span className="text-xs px-2.5 py-1 rounded-full bg-red-950/40 border border-red-900/50 text-red-400 font-medium">
          Code {info.error_code}
        </span>
      </div>

      <div className="mb-3">
        <span className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
          Contract ID
        </span>
        <div className="flex items-center gap-2">
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-sm text-violet-300 hover:text-violet-100 underline underline-offset-2 break-all transition-colors"
          >
            {info.contract_id}
          </a>
          <button
            onClick={handleCopy}
            aria-label="Copy contract ID"
            title={copied ? "Copied!" : "Copy contract ID"}
            className="shrink-0 p-1.5 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            {copied ? (
              /* checkmark icon */
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-4 h-4 text-emerald-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              /* clipboard icon */
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="9" y="2" width="6" height="4" rx="1" ry="1" />
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {hasDetails && (
        <details className="mt-3 group">
          <summary className="cursor-pointer text-xs font-semibold text-slate-400 uppercase tracking-wider select-none list-none flex items-center gap-1 hover:text-slate-200 transition-colors">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-3.5 h-3.5 transition-transform group-open:rotate-90"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            Error Details
          </summary>

          <div className="mt-3 space-y-3 pl-1">
            {info.error_name && (
              <div>
                <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-0.5">
                  Error Name
                </span>
                <span className="font-mono text-sm text-slate-200">
                  {info.error_name}
                </span>
              </div>
            )}
            {info.doc_comment && (
              <div>
                <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-0.5">
                  Documentation
                </span>
                <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
                  {info.doc_comment}
                </p>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

interface TaxonomyEntry {
  code: number;
  name: string;
  summary: string;
  detailed_explanation: string;
  common_causes: Array<{ description: string }>;
  suggested_fixes: Array<{ description: string }>;
}

export function ContractErrorViewContent() {
  const [selectedCode, setSelectedCode] = useState<number>(0);
  const [customCode, setCustomCode] = useState<string>("");
  const [isCustomMode, setIsCustomMode] = useState<boolean>(false);
  const [wasmError, setWasmError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    initWasm().catch((err) => {
      if (active) {
        setWasmError(err instanceof Error ? err : new Error(String(err)));
      }
    });
    return () => {
      active = false;
    };
  }, []);

  if (wasmError) {
    throw wasmError;
  }

  const standardContractErrors = contractTaxonomy as Record<
    string,
    TaxonomyEntry
  >;
  const activeError = isCustomMode
    ? standardContractErrors[customCode]
    : standardContractErrors[String(selectedCode)];

  const handleCustomCodeChange = (val: string) => {
    setCustomCode(val);
    setIsCustomMode(val.trim() !== "");
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl max-w-3xl mx-auto my-6 text-slate-100">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold tracking-tight text-violet-400">
          📋 Contract Error Lookup
        </h2>
        <span className="text-xs px-2.5 py-1 rounded-full bg-violet-950/50 border border-violet-800/50 text-violet-300 font-mono">
          HostError::Contract
        </span>
      </div>

      <p className="text-sm text-slate-400 mb-6">
        Soroban smart contracts return numeric codes when they revert. Select a
        standard code or enter a custom code to view its details.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div>
          <label
            htmlFor="standard-code-select"
            className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2"
          >
            Select Standard Code
          </label>
          <select
            id="standard-code-select"
            value={selectedCode}
            onChange={(e) => {
              setSelectedCode(Number(e.target.value));
              setIsCustomMode(false);
              setCustomCode("");
            }}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-colors"
          >
            {Object.values(standardContractErrors).map((err) => (
              <option key={err.code} value={err.code}>
                Code {err.code}: {err.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="custom-code-input"
            className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2"
          >
            Or Type Any Code
          </label>
          <input
            id="custom-code-input"
            type="number"
            value={customCode}
            onChange={(e) => handleCustomCodeChange(e.target.value)}
            placeholder="e.g. 42"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-colors"
          />
        </div>
      </div>

      {activeError ? (
        <div className="border-t border-slate-800 pt-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <span className="text-xs font-bold text-violet-400 uppercase tracking-wider">
                Category: Contract
              </span>
              <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2 mt-1">
                {activeError.name}
                <span className="text-sm font-mono text-slate-500 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                  Code {activeError.code}
                </span>
              </h3>
            </div>
            <span className="text-xs px-2.5 py-1 rounded bg-red-950/40 border border-red-900/50 text-red-400 font-medium">
              Error
            </span>
          </div>

          <div className="bg-slate-950 rounded-lg p-4 border border-slate-800 mb-4">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
              Summary
            </h4>
            <p className="text-slate-300 text-sm">{activeError.summary}</p>
          </div>

          <div className="mb-4">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
              Detailed Explanation
            </h4>
            <p className="text-slate-400 text-sm leading-relaxed">
              {activeError.detailed_explanation}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
            <div>
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                Common Causes
              </h4>
              <ul className="space-y-2">
                {activeError.common_causes.map((cause, i) => (
                  <li
                    key={i}
                    className="text-sm text-slate-300 flex items-start gap-2"
                  >
                    <span className="text-red-400 mt-1">•</span>
                    <span>{cause.description}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                Suggested Fixes
              </h4>
              <ul className="space-y-2">
                {activeError.suggested_fixes.map((fix, i) => (
                  <li
                    key={i}
                    className="text-sm text-slate-300 flex items-start gap-2"
                  >
                    <span className="text-emerald-400 mt-1">✓</span>
                    <span>{fix.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : isCustomMode && customCode.trim() !== "" ? (
        <div className="border-t border-slate-800 pt-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                Category: Contract (Custom)
              </span>
              <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2 mt-1">
                CustomContractError
                <span className="text-sm font-mono text-slate-500 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                  Code {customCode}
                </span>
              </h3>
            </div>
            <span className="text-xs px-2.5 py-1 rounded bg-red-950/40 border border-red-900/50 text-red-400 font-medium">
              Error
            </span>
          </div>

          <div className="bg-slate-950 rounded-lg p-4 border border-slate-800 mb-4">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
              Summary
            </h4>
            <p className="text-slate-300 text-sm">
              The contract reverted with custom error code {customCode}.
            </p>
          </div>

          <div className="mb-4">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
              Detailed Explanation
            </h4>
            <p className="text-slate-400 text-sm leading-relaxed">
              This is a custom contract-defined error code. Custom error codes
              are defined by the contract author inside their{" "}
              {"`#[contracterror]`"} enum. To map this code to its name, you
              need the contract{"'s"} WASM specification or source code.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
            <div>
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                Common Causes
              </h4>
              <ul className="space-y-2">
                <li className="text-sm text-slate-300 flex items-start gap-2">
                  <span className="text-red-400 mt-1">•</span>
                  <span>
                    A business logic requirement or assertion in the contract
                    {"'s"} code was not met.
                  </span>
                </li>
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                Suggested Fixes
              </h4>
              <ul className="space-y-2">
                <li className="text-sm text-slate-300 flex items-start gap-2">
                  <span className="text-emerald-400 mt-1">✓</span>
                  <span>
                    Locate the source code of the contract and find its{" "}
                    {"`#[contracterror]`"} enum.
                  </span>
                </li>
                <li className="text-sm text-slate-300 flex items-start gap-2">
                  <span className="text-emerald-400 mt-1">✓</span>
                  <span>
                    Match the numeric code {customCode} with the integer values
                    assigned to the enum variants.
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function ContractErrorView() {
  return (
    <ErrorBoundary isWasm>
      <ContractErrorViewContent />
    </ErrorBoundary>
  );
}
