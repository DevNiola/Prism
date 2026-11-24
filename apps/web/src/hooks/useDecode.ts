import { useCallback, useState } from "react";
import type { DiagnosticReport, Network, TxHash } from "@/lib/types";

export function useDecode() {
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decode = useCallback(async (txHash: TxHash, network: Network, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const response = await fetch("/api/decode", {
        method: "POST",
        signal,
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
      return decoded;
    } catch (decodeError) {
      if (signal?.aborted) return null;
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

  return { report, loading, error, decode };
}
