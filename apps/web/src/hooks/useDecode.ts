import { useCallback, useState } from "react";
import type { DiagnosticReport } from "@/lib/types";

export function useDecode() {
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decode = useCallback(async (txHash: string, network: string) => {
    setLoading(true);
    setError(null);
    setReport(null);
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
      return decoded;
    } catch (decodeError) {
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
