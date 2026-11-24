"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useNetworkStore } from "@/store/network";
import { useSessionStore, type SessionLocation } from "@/store/session";
import type { Network } from "@/lib/types";

export function parseSessionNetwork(value: string | null): Network | null {
  switch (value) {
    case "mainnet":
    case "testnet":
    case "futurenet":
    case "custom":
      return value;
    default:
      return null;
  }
}

export function useSessionUrl(page: "decode" | "trace") {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const preferredNetwork = useNetworkStore((state) => state.network);
  const explicitNetwork = parseSessionNetwork(params.get("network"));
  const txHash = params.get("txHash")?.trim() || null;
  const view = page === "trace" ? "trace" : params.get("view") === "lookup" ? "lookup" : "diagnose";
  const historyNetwork = useSessionStore((state) =>
    page === "decode" && txHash
      ? state.history.find((entry) => entry.txHash === txHash)?.network
      : undefined,
  );
  const network = explicitNetwork ?? historyNetwork ?? (page === "trace" ? "testnet" : preferredNetwork);

  useEffect(() => {
    useSessionStore.getState().setSessionLocation({ txHash, network, view });
  }, [txHash, network, view]);

  function updateSessionUrl(changes: Partial<SessionLocation>) {
    const session = { txHash, network, view, ...changes };
    const next = new URLSearchParams(params.toString());
    if (session.txHash) next.set("txHash", session.txHash);
    else next.delete("txHash");
    next.set("network", session.network);
    next.set("view", session.view);

    if (next.toString() !== params.toString()) {
      router.push(`${pathname}?${next}${window.location.hash}`, { scroll: false });
    }
  }

  return { txHash, network, view, updateSessionUrl };
}
