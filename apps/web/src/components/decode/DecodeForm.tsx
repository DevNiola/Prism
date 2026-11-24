"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useDecode } from "@/hooks/useDecode";
import { isTxHash, type DiagnosticReport, type Network, type TxHash } from "@/lib/types";

interface DecodeFormProps {
  initialTxHash?: string;
  network: Network;
  onDecode: (report: DiagnosticReport | null, txHash?: TxHash) => void;
}

export default function DecodeForm({ initialTxHash = "", network, onDecode }: DecodeFormProps) {
  const [hash, setHash] = useState(initialTxHash);
  const [hashTouched, setHashTouched] = useState(false);
  const [pasteMessage, setPasteMessage] = useState("");
  const [pasting, setPasting] = useState(false);
  const { decode, loading, error } = useDecode();
  const hashInput = useRef<HTMLInputElement>(null);
  const submitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useRef<AbortController | null>(null);
  const validHash = isTxHash(hash);
  const hashError = hashTouched && !validHash;

  useEffect(() => () => {
    if (submitTimer.current !== null) clearTimeout(submitTimer.current);
    submitTimer.current = null;
    request.current?.abort();
  }, [network]);

  function updateHash(value: string) {
    if (submitTimer.current !== null) clearTimeout(submitTimer.current);
    submitTimer.current = null;
    setHash(value);
    setHashTouched(true);
    setPasteMessage("");
  }

  async function pasteHash() {
    setPasting(true);
    try {
      updateHash((await navigator.clipboard.readText()).trim());
    } catch {
      setPasteMessage("Use your browser’s paste shortcut to enter the transaction hash.");
    } finally {
      setPasting(false);
      hashInput.current?.focus();
    }
  }

  function submitHash(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHashTouched(true);
    if (!isTxHash(hash) || request.current || pasting) return;
    if (submitTimer.current !== null) clearTimeout(submitTimer.current);
    submitTimer.current = setTimeout(async () => {
      submitTimer.current = null;
      const controller = new AbortController();
      request.current = controller;
      onDecode(null);
      try {
        const decoded = await decode(hash, network, controller.signal);
        if (decoded && !controller.signal.aborted) onDecode(decoded, hash);
      } finally {
        request.current = null;
      }
    }, 400);
  }

  const [category, setCategory] = useState<string>("contract");
  const [code, setCode] = useState<string>("0");
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const mockDecode = (cat: string, codeVal: number): DiagnosticReport => {
    switch (cat.toLowerCase()) {
      case "contract":
        if (codeVal === 1) {
          return {
            error_category: "Contract",
            error_code: 1,
            error_name: "InternalError",
            summary:
              "An internal protocol implementation error occurred (e.g. invalid ledger state).",
            detailed_explanation:
              "The contract encountered an internal error during execution, indicating a protocol implementation issue or invalid ledger state.",
            severity: "error",
            root_causes: [
              {
                description:
                  "Internal validation or state consistency checks failed in the contract",
                likelihood: "high",
              },
            ],
            suggested_fixes: [
              {
                description:
                  "Check the diagnostic logs to see if there are internal contract assertion failures",
                difficulty: "medium",
                requires_upgrade: false,
              },
            ],
          };
        } else if (codeVal === 2) {
          return {
            error_category: "Contract",
            error_code: 2,
            error_name: "OperationNotSupportedError",
            summary:
              "The operation is not supported (e.g. calling clawback on an asset without clawback enabled).",
            detailed_explanation:
              "The contract attempted an operation that is unsupported by the contract configuration or type (e.g., performing a clawback on an asset when clawback is disabled).",
            severity: "error",
            root_causes: [
              {
                description: "Invoking clawback on a non-clawbackable asset",
                likelihood: "high",
              },
            ],
            suggested_fixes: [
              {
                description:
                  "Check the asset flags and ensure the operation is allowed for the target asset",
                difficulty: "easy",
                requires_upgrade: false,
              },
            ],
          };
        } else if (codeVal === 3) {
          return {
            error_category: "Contract",
            error_code: 3,
            error_name: "AlreadyInitializedError",
            summary:
              "The contract instance has already been initialized and cannot be re-initialized.",
            detailed_explanation:
              "The contract instance was initialized twice. Soroban contracts typically only allow initialization once.",
            severity: "error",
            root_causes: [
              {
                description:
                  "Calling the initialize function on an already initialized contract instance",
                likelihood: "high",
              },
            ],
            suggested_fixes: [
              {
                description:
                  "Ensure that initialization is only called once per contract deployment",
                difficulty: "easy",
                requires_upgrade: false,
              },
            ],
          };
        } else if (codeVal === 6) {
          return {
            error_category: "Contract",
            error_code: 6,
            error_name: "AccountMissingError",
            summary:
              "An account involved in the transaction does not exist on the network.",
            detailed_explanation:
              "The operation required a specific account to exist on the network, but the account could not be found.",
            severity: "error",
            root_causes: [
              {
                description:
                  "Providing an invalid account address or an account that has not been created/funded",
                likelihood: "high",
              },
            ],
            suggested_fixes: [
              {
                description:
                  "Verify that the addresses provided exist and are active on the target network",
                difficulty: "easy",
                requires_upgrade: false,
              },
            ],
          };
        } else {
          return {
            error_category: "Contract",
            error_code: codeVal,
            error_name: "ContractError",
            summary:
              "Contract error: the contract's own logic rejected this call — run with --resolve to map the code to its name.",
            detailed_explanation:
              "Unlike host errors, contract errors are defined by the contract author. Each contract can define an error enum with numeric codes and descriptive names. When a contract panics or returns an error value, the host wraps it as a ContractError with the numeric code.",
            severity: "error",
            root_causes: [
              {
                description: "Business logic assertion failure in the contract",
                likelihood: "high",
              },
            ],
            suggested_fixes: [
              {
                description:
                  "Review the contract source code for the error enum definition to understand the specific failure",
                difficulty: "medium",
                requires_upgrade: false,
              },
            ],
          };
        }

      case "budget":
        return {
          error_category: "Budget",
          error_code: codeVal,
          error_name: "CpuLimitExceeded",
          summary:
            "CPU limit exceeded: the transaction ran out of CPU instructions before completing execution.",
          detailed_explanation:
            "The transaction exceeded its CPU instruction budget. Each transaction has a fixed CPU budget limits defined by the protocol to prevent infinite loops.",
          severity: "fatal",
          root_causes: [
            {
              description:
                "Infinite loops or excessive complexity in contract execution path",
              likelihood: "high",
            },
          ],
          suggested_fixes: [
            {
              description: "Optimize contract code and reduce loop count",
              difficulty: "medium",
              requires_upgrade: false,
            },
          ],
        };

      default:
        return {
          error_category: cat.toUpperCase(),
          error_code: codeVal,
          error_name: "UnknownError",
          summary: `An unknown error occurred in category ${cat}.`,
          detailed_explanation:
            "This error code and category combination is not registered as a standard host error or contract error.",
          severity: "error",
          root_causes: [],
          suggested_fixes: [],
        };
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setTimeout(() => {
      const decodedReport = mockDecode(category, Number(code));
      onDecode(decodedReport);
      setIsLoading(false);
    }, 500);
  };

  return (
    <div className="card-interactive bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl max-w-3xl mx-auto my-6 text-slate-100">
      <h2 className="mb-4 text-xl font-bold text-violet-400">Decode Transaction</h2>
      <form onSubmit={submitHash} className="mb-6 space-y-3 border-b border-slate-800 pb-6">
        <label htmlFor="decode-tx-hash" className="block text-sm font-medium">
          Transaction hash
        </label>
        <div className="flex gap-2">
          <input
            ref={hashInput}
            id="decode-tx-hash"
            value={hash}
            onChange={(event) => updateHash(event.target.value)}
            onBlur={() => { if (hash) setHashTouched(true); }}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={loading || pasting}
            aria-invalid={hashError}
            aria-describedby={hashError ? "decode-hash-error" : undefined}
            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono"
          />
          <button
            type="button"
            onClick={pasteHash}
            disabled={loading || pasting}
            className="rounded-lg border border-slate-600 px-4 py-2 disabled:opacity-50"
          >
            Paste
          </button>
        </div>
        {hashError && (
          <p id="decode-hash-error" role="alert" className="text-sm text-rose-400">
            Enter exactly 64 lowercase hexadecimal characters.
          </p>
        )}
        {pasteMessage && <p role="status" className="text-sm text-slate-300">{pasteMessage}</p>}
        {error && !hashError && <p role="alert" className="text-sm text-rose-400">{error}</p>}
        <button
          type="submit"
          disabled={!validHash || loading || pasting}
          className="rounded-lg bg-violet-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {loading ? "Decoding…" : "Decode transaction"}
        </button>
      </form>
      <h2 className="text-xl font-bold tracking-tight text-violet-400 mb-4">
        🔎 Decode Error Code
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Error Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-slate-200 focus:outline-none focus:border-violet-500 transition-colors"
            >
              <option value="contract">Contract (HostError::Contract)</option>
              <option value="budget">Budget (HostError::Budget)</option>
              <option value="storage">Storage (HostError::Storage)</option>
              <option value="auth">Auth (HostError::Auth)</option>
              <option value="value">Value (HostError::Value)</option>
              <option value="wasm">Wasm (HostError::Wasm)</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="decode-error-code"
              className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2"
            >
              Error Code (Numeric)
            </label>
            <input
              id="decode-error-code"
              type="number"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. 1"
              min="0"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-violet-500 transition-colors"
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={isLoading}
            className="btn-press btn-pulse bg-violet-600 hover:bg-violet-500 text-white font-medium px-6 py-2.5 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? "Decoding..." : "Diagnose Error"}
          </button>
        </div>
      </form>
    </div>
  );
}
