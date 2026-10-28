import { useCallback, useState } from "react";
import type { DiagnosticReport } from "@/lib/types";

export function useDecode() {
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [optimisticResult, setOptimisticResult] = useState<DiagnosticReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decode = useCallback(async (txHash: string, network: string) => {
    setLoading(true);
    setError(null);
    setReport(null);

    // Provide immediate optimistic feedback (<100ms)
    const optimisticPlaceholder: DiagnosticReport = {
      error_category: "Transaction",
      error_code: 0,
      error_name: "Decoding in progress...",
      summary: `Decoding transaction ${txHash} on ${network}...`,
      detailed_explanation: "Analyzing transaction execution traces and contract diagnostics from ledger state.",
      severity: "info",
      root_causes: [],
      suggested_fixes: [],
      transaction_context: {
        tx_hash: txHash,
        ledger_sequence: 0,
        function_name: "unknown",
        arguments: [],
        fee: {
          total_charged_fee: 0,
          inclusion_fee: 0,
          resource_fee: 0,
          refundable_resource_fee: 0,
          refundable_fee: 0,
          non_refundable_fee: 0,
        },
        resources: {
          cpu_instructions_used: 0,
          cpu_instructions_limit: 0,
          memory_bytes_used: 0,
          memory_bytes_limit: 0,
          read_bytes: 0,
          read_limit: 0,
          write_bytes: 0,
          write_limit: 0,
        },
      },
    };
    setOptimisticResult(optimisticPlaceholder);

    try {
      const response = await fetch("/api/decode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash, network }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? "Unable to decode transaction.");
      }

      const decoded = (await response.json()) as DiagnosticReport;
      setReport(decoded);
      setOptimisticResult(null);
      return decoded;
    } catch (decodeError) {
      setOptimisticResult(null);
      setError(
        decodeError instanceof Error
          ? decodeError.message
          : "Unable to decode transaction."
      );
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    report,
    optimisticResult,
    loading,
    error,
    decode,
    setReport,
    setOptimisticResult,
    setError,
  };
}
