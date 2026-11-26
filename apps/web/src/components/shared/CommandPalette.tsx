"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { recentTransactionHref, truncateHash } from "./RecentTransactions";
import { useSessionStore } from "@/store/session";
import { useNetworkStore } from "@/store/network";
import type { Network } from "@/lib/types";
import { triggerTourReplay } from "@/components/shared/OnboardingTour";

type Theme = "dark" | "light";

interface PaletteCommand {
  id: string;
  title: string;
  detail: string;
  keywords: string;
  run: () => void;
}

const NETWORKS: Array<{ value: Network; label: string }> = [
  { value: "mainnet", label: "Mainnet" },
  { value: "testnet", label: "Testnet" },
  { value: "futurenet", label: "Futurenet" },
];

const LAST_COMMAND_KEY = "prism-last-command";

function matchScore(term: string, value: string): number {
  const text = value.toLowerCase();
  if (text === term) return 4;
  if (text.startsWith(term)) return 3;
  if (text.includes(term)) return 2;

  let position = 0;
  for (const character of term) {
    const index = text.indexOf(character, position);
    if (index < 0) return 0;
    position = index + 1;
  }
  return 1;
}

function rankCommands(commands: PaletteCommand[], terms: string[]) {
  return commands
    .map((command) => {
      let score = 0;
      for (const term of terms) {
        const best = Math.max(
          matchScore(term, command.title) * 2,
          matchScore(term, command.id),
          matchScore(term, command.detail),
          matchScore(term, command.keywords),
        );
        if (best === 0) return { command, score: -1 };
        score += best;
      }
      return { command, score };
    })
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score)
    .map(({ command }) => command);
}

export default function CommandPalette() {
  const router = useRouter();
  const { network, setNetwork } = useNetworkStore();
  const history = useSessionStore((state) => state.history);
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState<Theme>("dark");
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLastCommand(localStorage.getItem(LAST_COMMAND_KEY));
    const savedTheme = localStorage.getItem("prism-theme");
    const nextTheme: Theme = savedTheme === "light" ? "light" : "dark";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
        setQuery("");
        setMessage("");
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const commands = useMemo<PaletteCommand[]>(
    () => [
      {
        id: "decode",
        title: "Open Decode",
        detail: "Diagnose a transaction error",
        keywords: "decode diagnose error",
        run: () => router.push("/decode"),
      },
      {
        id: "trace",
        title: "Open Trace",
        detail: "Inspect transaction execution",
        keywords: "trace execution transaction",
        run: () => router.push("/trace"),
      },
      {
        id: "debug",
        title: "Open Debug",
        detail: "Open the interactive debugger",
        keywords: "debug debugger breakpoint",
        run: () => router.push("/debug"),
      },
      ...NETWORKS.filter(({ value }) => value !== network).map(
        ({ value, label }) => ({
          id: `network-${value}`,
          title: `Switch to ${label}`,
          detail: "Change the active Stellar network",
          keywords: `network ${label} switch`,
          run: () => setNetwork(value),
        }),
      ),
      {
        id: "theme",
        title: `Use ${theme === "dark" ? "light" : "dark"} theme`,
        detail: "Toggle the application appearance",
        keywords: "theme appearance light dark",
        run: () => {
          const nextTheme: Theme = theme === "dark" ? "light" : "dark";
          setTheme(nextTheme);
          localStorage.setItem("prism-theme", nextTheme);
          document.documentElement.dataset.theme = nextTheme;
        },
      },
      {
        id: "tour",
        title: "Restart onboarding tour",
        detail: "Re-run the getting-started walkthrough",
        keywords: "tour onboarding help walkthrough guide",
        run: () => {
          setOpen(false);
          triggerTourReplay();
        },
      },
      {
        id: "paste-transaction",
        title: "Paste transaction hash",
        detail: "Read a hash from the clipboard and open Trace",
        keywords: "paste clipboard transaction hash tx",
        run: () => {
          void navigator.clipboard
            .readText()
            .then((clipboardText) => {
              const hash = clipboardText.trim();
              if (!/^[\da-fA-F]{64}$/.test(hash)) {
                setMessage("Clipboard does not contain a 64-character transaction hash.");
                return;
              }
              setOpen(false);
              router.push(`/trace?txHash=${encodeURIComponent(hash)}`);
            })
            .catch(() => {
              setMessage("Clipboard access is unavailable. Check browser permissions.");
            });
        },
      },
    ],
    [network, router, setNetwork, theme],
  );

  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const visibleCommands = rankCommands(commands, terms);
  if (terms.length === 0) {
    visibleCommands.sort((a, b) => Number(b.id === lastCommand) - Number(a.id === lastCommand));
  }

  const recentCommands = rankCommands(
    history.map((entry) => ({
      id: `recent-${entry.id}`,
      title: /^[0-9a-f]{64}$/i.test(entry.txHash) ? truncateHash(entry.txHash) : entry.errorName,
      detail: `${entry.network} · ${entry.errorName}`,
      keywords: `${entry.txHash} ${entry.errorCategory}`,
      run: () => router.push(recentTransactionHref(entry)),
    })),
    terms,
  );
  const firstResult = visibleCommands[0] ?? recentCommands[0];

  function runCommand(command: PaletteCommand) {
    setLastCommand(command.id);
    localStorage.setItem(LAST_COMMAND_KEY, command.id);
    setMessage("");
    command.run();
    if (command.id !== "paste-transaction") setOpen(false);
  }

  function renderCommand(command: PaletteCommand) {
    return (
      <li key={command.id} role="presentation">
        <button
          type="button"
          role="option"
          aria-selected={command.id === lastCommand}
          onClick={() => runCommand(command)}
          className="flex w-full items-center justify-between gap-4 rounded-md px-3 py-3 text-left hover:bg-slate-100 focus:bg-slate-100 focus:outline-none"
        >
          <span>
            <span className="block text-sm font-medium text-slate-900">{command.title}</span>
            <span className="mt-0.5 block text-xs text-slate-600">{command.detail}</span>
          </span>
          {command.id === lastCommand && (
            <span className="text-xs text-slate-500">Last selected</span>
          )}
        </button>
      </li>
    );
  }

  return (
    <>
      {message && !open && (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-50 max-w-sm rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-lg"
        >
          {message}
          <button
            type="button"
            onClick={() => setMessage("")}
            aria-label="Dismiss message"
            className="ml-3 font-semibold"
          >
            Close
          </button>
        </div>
      )}
      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 px-4 pt-[15vh]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="w-full max-w-xl overflow-hidden rounded-lg border border-slate-300 bg-white shadow-2xl"
          >
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing && firstResult) {
                  event.preventDefault();
                  runCommand(firstResult);
                }
              }}
              placeholder="Search commands or transactions..."
              aria-label="Search commands or transactions"
              className="w-full border-b border-slate-200 px-4 py-4 text-base text-slate-900 outline-none placeholder:text-slate-500"
            />
            <div className="max-h-[50vh] overflow-y-auto p-2">
              {visibleCommands.length > 0 && (
                <ul role="listbox" aria-label="Commands">
                  {visibleCommands.map(renderCommand)}
                </ul>
              )}
              {recentCommands.length > 0 && (
                <div className="mt-2 border-t border-slate-200 pt-2">
                  <h2 id="palette-recent-transactions" className="px-3 py-1 text-xs font-semibold text-slate-600">
                    Recent transactions
                  </h2>
                  <ul role="listbox" aria-labelledby="palette-recent-transactions">
                    {recentCommands.map(renderCommand)}
                  </ul>
                </div>
              )}
              {!firstResult && (
                <p className="px-3 py-8 text-center text-sm text-slate-500">No matching results</p>
              )}
            </div>
            {message && (
              <p role="status" className="border-t border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {message}
              </p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
