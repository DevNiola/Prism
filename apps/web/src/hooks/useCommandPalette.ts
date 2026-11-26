"use client";

import { useCallback, useEffect, useState } from "react";

export interface Command {
  id: string;
  label: string;
  hint?: string;
  perform: () => void;
}

interface UseCommandPaletteResult {
  open: boolean;
  query: string;
  setOpen: (v: boolean) => void;
  setQuery: (q: string) => void;
  openPalette: () => void;
  closePalette: () => void;
}

/**
 * Manages the open/closed state and query for a command palette, and registers
 * a global ⌘/Ctrl+K shortcut to toggle it.
 */
export function useCommandPalette(): UseCommandPaletteResult {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const openPalette = useCallback(() => setOpen(true), []);
  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return { open, query, setOpen, setQuery, openPalette, closePalette };
}
