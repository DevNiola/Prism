"use client";

import { useEffect, useRef, type RefObject } from "react";

export interface FocusRestorer {
  /** Record the element that currently has focus (call before moving focus). */
  capture: () => void;
  /** Return focus to the element captured by `capture`, if it is still present. */
  restore: () => void;
  /** The element captured by the last `capture` call. */
  readonly target: HTMLElement | null;
}

/**
 * Create a focus restorer bound to a specific document. Exposed so it can be
 * used outside React and unit-tested without a DOM: `capture()` remembers the
 * currently focused element, and `restore()` moves focus back to it — e.g.
 * after a modal/panel closes (including when closed via Esc).
 */
export function createFocusRestorer(doc: Document = document): FocusRestorer {
  let previous: HTMLElement | null = null;
  return {
    capture() {
      previous = (doc.activeElement as HTMLElement | null) ?? null;
    },
    restore() {
      const el = previous;
      previous = null;
      // Only restore to an element that is still connected to the document;
      // restoring to a removed node would throw or silently no-op.
      if (el && typeof el.focus === "function" && doc.contains(el)) {
        el.focus();
      }
    },
    get target() {
      return previous;
    },
  };
}

/**
 * Records the element that had focus when `active` becomes true and restores
 * focus to it when `active` becomes false (close, including Esc-driven close).
 *
 * Pass a ref to the panel root element; while open it is focused so the surface
 * is keyboard-reachable, and on close focus is returned to the triggering
 * element that opened the panel.
 */
export function useFocusRestore<T extends HTMLElement>(
  active: boolean,
  panelRef: RefObject<T | null>
): void {
  const restorerRef = useRef<FocusRestorer | null>(null);

  useEffect(() => {
    if (!active || typeof document === "undefined") return;

    const restorer = createFocusRestorer(document);
    restorer.capture();
    restorerRef.current = restorer;

    // Move focus into the panel so keyboard users land inside it.
    const panel = panelRef.current;
    if (panel) {
      panel.focus();
    }

    return () => {
      restorer.restore();
      restorerRef.current = null;
    };
  }, [active, panelRef]);
}
