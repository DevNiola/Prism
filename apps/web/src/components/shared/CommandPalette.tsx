"use client";

import { useEffect, useRef, useState } from "react";
import type { Command } from "@/hooks/useCommandPalette";

interface CommandPaletteProps {
  commands: Command[];
  open: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  onClose: () => void;
}

/**
 * Accessible command palette.
 *
 * ARIA pattern: the dialog has role="dialog" / aria-modal. The search input is
 * the single focusable control; it owns the results via aria-controls and
 * points at the active option via aria-activedescendant. The results are a
 * role="listbox" of role="option" items with aria-selected, navigable with the
 * arrow keys.
 */
export default function CommandPalette({
  commands,
  open,
  query,
  onQueryChange,
  onClose,
}: CommandPaletteProps) {
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = commands.filter((c) =>
    c.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  // Reset selection and focus whenever the palette opens or the query changes.
  useEffect(() => {
    setActive(0);
  }, [query, open]);

  useEffect(() => {
    if (open) {
      // Defer to allow the dialog to mount before focusing.
      const id = window.requestAnimationFrame(() => inputRef.current?.focus());
      return () => window.cancelAnimationFrame(id);
    }
  }, [open]);

  // Keep the active option scrolled into view during keyboard navigation.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-index="${active}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  if (!open) return null;

  const activeId =
    filtered[active] !== undefined ? `cmd-option-${filtered[active].id}` : undefined;

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((a) => Math.min(a + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(Math.max(filtered.length - 1, 0));
        break;
      case "Enter": {
        e.preventDefault();
        const cmd = filtered[active];
        if (cmd) {
          cmd.perform();
          onClose();
        }
        break;
      }
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4"
      // Presentation wrapper; the dialog role lives on the inner panel.
      role="presentation"
    >
      <div
        className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-xl rounded-xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden"
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a command…"
          aria-label="Search commands"
          aria-controls="command-palette-results"
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          className="w-full border-b border-slate-800 bg-transparent px-4 py-3 text-slate-100 placeholder-slate-500 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500/70 focus-visible:-outline-offset-2"
        />
        <ul
          id="command-palette-results"
          ref={listRef}
          role="listbox"
          aria-label="Commands"
          className="max-h-72 overflow-y-auto py-2"
        >
          {filtered.length === 0 ? (
            <li
              role="presentation"
              className="px-4 py-3 text-sm text-slate-500"
            >
              No matching commands
            </li>
          ) : (
            filtered.map((c, i) => {
              const selected = i === active;
              return (
                <li
                  key={c.id}
                  id={`cmd-option-${c.id}`}
                  data-index={i}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => {
                    c.perform();
                    onClose();
                  }}
                  className={`flex items-center justify-between px-4 py-2 text-sm cursor-pointer focus:outline-none ${
                    selected
                      ? "bg-violet-600 text-white"
                      : "text-slate-200 hover:bg-slate-800"
                  }`}
                >
                  <span>{c.label}</span>
                  {c.hint && (
                    <span
                      className={`text-xs ${selected ? "text-violet-200" : "text-slate-500"}`}
                    >
                      {c.hint}
                    </span>
                  )}
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
