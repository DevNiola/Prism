"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useNetworkStore } from "@/store/network";
import type { Network } from "@/lib/types";

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

function fuzzyMatch(query: string, text: string) {
  let queryIndex = 0;
  const normalizedText = text.toLowerCase();

  for (const character of query.toLowerCase()) {
    queryIndex = normalizedText.indexOf(character, queryIndex);
    if (queryIndex === -1) return false;
    queryIndex += 1;
  }

  return true;
}

export default function CommandPalette() {
  const router = useRouter();
  const { network, setNetwork } = useNetworkStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState<Theme>("dark");
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
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

  const visibleCommands = commands.filter((command) =>
    fuzzyMatch(query.trim(), `${command.title} ${command.detail} ${command.keywords}`),
  );

  function runCommand(command: PaletteCommand) {
    setMessage("");
    command.run();
    if (command.id !== "paste-transaction") setOpen(false);
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
              placeholder="Search commands..."
              aria-label="Search commands"
              className="w-full border-b border-slate-200 px-4 py-4 text-base text-slate-900 outline-none placeholder:text-slate-500"
            />
            <ul role="listbox" aria-label="Commands" className="max-h-[50vh] overflow-y-auto p-2">
              {visibleCommands.map((command) => (
                <li key={command.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected="false"
                    onClick={() => runCommand(command)}
                    className="flex w-full items-center justify-between gap-4 rounded-md px-3 py-3 text-left hover:bg-slate-100 focus:bg-slate-100 focus:outline-none"
                  >
                    <span>
                      <span className="block text-sm font-medium text-slate-900">
                        {command.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-600">
                        {command.detail}
                      </span>
                    </span>
                    {command.id.startsWith("network-") && (
                      <span className="text-xs text-slate-500">{network}</span>
                    )}
                  </button>
                </li>
              ))}
              {visibleCommands.length === 0 && (
                <li className="px-3 py-8 text-center text-sm text-slate-500">
                  No matching commands
                </li>
              )}
            </ul>
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