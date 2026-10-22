"use client";

import { useNetworkStore } from "@/store/network";

export default function NetworkSwitcher() {
  const network = useNetworkStore((state) => state.network);
  const setNetwork = useNetworkStore((state) => state.setNetwork);

  return (
    <select
      aria-label="Network"
      value={network}
      onChange={(event) => setNetwork(event.target.value as typeof network)}
      className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
    >
      <option value="testnet">Testnet</option>
      <option value="mainnet">Mainnet</option>
      <option value="futurenet">Futurenet</option>
      <option value="custom">Custom</option>
    </select>
  );
}
