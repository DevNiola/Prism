"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/hooks/useToast";
import { prettyPrintXdr, readXdrBase64, type StellarXdrType } from "@/lib/wasm";

interface XdrViewerProps {
  xdr: string;
  xdrType: StellarXdrType;
}

export default function XdrViewer({ xdr, xdrType }: XdrViewerProps) {
  const [pretty, setPretty] = useState(false);
  const [decoded, setDecoded] = useState<{
    source: string;
    type: StellarXdrType;
    text: string;
    error?: string;
  } | null>(null);
  const { showToast } = useToast();

  let base64Error: string | undefined;
  if (xdr.trim()) {
    try {
      readXdrBase64(xdr);
    } catch (error) {
      base64Error = error instanceof Error ? error.message : "Invalid base64 XDR.";
    }
  }

  useEffect(() => {
    if (!pretty || !xdr.trim() || base64Error) return;
    let active = true;
    prettyPrintXdr(xdr, xdrType).then(
      (text) => {
        if (active) setDecoded({ source: xdr, type: xdrType, text });
      },
      (error: unknown) => {
        if (active) setDecoded({
          source: xdr,
          type: xdrType,
          text: "",
          error: error instanceof Error ? error.message : "Unable to decode XDR.",
        });
      },
    );
    return () => { active = false; };
  }, [pretty, xdr, xdrType, base64Error]);

  const result = decoded?.source === xdr && decoded.type === xdrType ? decoded : null;
  const error = base64Error ?? (pretty ? result?.error : undefined);
  const text = pretty ? result?.text : xdr;

  async function copy() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast("XDR copied to clipboard.", "success");
    } catch {
      showToast("Could not copy XDR to clipboard.", "error");
    }
  }

  return (
    <div className="space-y-3">
      <div role="group" aria-label="XDR display" className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={!pretty} onClick={() => setPretty(false)} className="rounded border px-3 py-1 aria-pressed:bg-violet-700">
          Raw base64
        </button>
        <button type="button" aria-pressed={pretty} onClick={() => setPretty(true)} className="rounded border px-3 py-1 aria-pressed:bg-violet-700">
          Pretty
        </button>
        <button type="button" disabled={!text} onClick={copy} className="rounded border px-3 py-1 disabled:opacity-50">
          Copy
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {pretty && xdr.trim() && !error && !result && <p role="status">Decoding XDR…</p>}
      {text && <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-900 p-3 text-sm">{text}</pre>}
    </div>
  );
}
