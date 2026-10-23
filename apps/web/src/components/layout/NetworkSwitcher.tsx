"use client";

import { useState } from "react";

export default function NetworkSwitcher() {
  const [network, setNetwork] = useState("testnet");

  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="network-select"
        className="text-sm font-medium text-slate-400 sr-only"
      >
        Select network
      </label>
      <select
        id="network-select"
        value={network}
        onChange={(e) => setNetwork(e.target.value)}
        aria-label="Select Stellar network"
        className="bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-colors"
      >
        <option value="testnet">Testnet</option>
        <option value="mainnet">Mainnet</option>
        <option value="futurenet">Futurenet</option>
      </select>
    </div>
  );
}
