"use client";

import { useState } from "react";

interface DecodeFormProps {
  onDecode: (txHash: string) => void;
  loading: boolean;
  error: string | null;
}

export default function DecodeForm({
  onDecode,
  loading,
  error,
}: DecodeFormProps) {
  const [txHash, setTxHash] = useState("");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const hash = txHash.trim();
    if (hash) onDecode(hash);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto my-6 max-w-3xl space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-6 text-slate-100 shadow-xl"
    >
      <h2 className="text-xl font-bold tracking-tight text-violet-400">
        Decode a transaction
      </h2>
      <label
        htmlFor="transaction-hash"
        className="block text-xs font-semibold uppercase tracking-wider text-slate-400"
      >
        Transaction hash
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id="transaction-hash"
          name="txHash"
          type="text"
          value={txHash}
          onChange={(event) => setTxHash(event.target.value)}
          placeholder="Paste a Stellar transaction hash"
          autoComplete="off"
          required
          className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-sm text-slate-200 placeholder:font-sans placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || txHash.trim().length === 0}
          className="rounded bg-violet-600 px-6 py-2.5 font-medium text-white transition-colors hover:bg-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Decoding..." : "Decode transaction"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}