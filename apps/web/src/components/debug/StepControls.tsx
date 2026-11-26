"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";

const shortcuts = [
  { action: "onStepOver", label: "Step over", key: "F10", shift: false },
  { action: "onStepInto", label: "Step into", key: "F11", shift: false },
  { action: "onStepOut", label: "Step out", key: "F11", shift: true },
  { action: "onContinue", label: "Continue", key: "F5", shift: false },
] as const;

type StepControlsProps = Partial<Record<(typeof shortcuts)[number]["action"], () => void>> & {
  scopeRef?: RefObject<HTMLElement | null>;
};

export default function StepControls({ scopeRef, ...actions }: StepControlsProps) {
  const controlsRef = useRef<HTMLDivElement>(null);
  const { onStepOver, onStepInto, onStepOut, onContinue } = actions;

  useEffect(() => {
    const scope = (scopeRef ?? controlsRef).current;
    if (!scope) return;
    const handlers = { onStepOver, onStepInto, onStepOut, onContinue };

    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (
        target.isContentEditable || target.closest("input, textarea, select, [role='textbox'], [role='dialog']")
      )) return;

      const shortcut = shortcuts.find(({ key, shift }) => event.key === key && event.shiftKey === shift);
      if (!shortcut) return;
      event.preventDefault();
      if (!event.repeat) handlers[shortcut.action]?.();
    }

    scope.addEventListener("keydown", handleKeyDown);
    return () => scope.removeEventListener("keydown", handleKeyDown);
  }, [scopeRef, onStepOver, onStepInto, onStepOut, onContinue]);

  return (
    <div ref={controlsRef} role="group" aria-label="Replay step controls" className="flex flex-wrap gap-2">
      {shortcuts.map(({ action, label, key, shift }) => {
        const hint = shift ? `Shift+${key}` : key;
        return (
          <button
            key={action}
            type="button"
            title={`${label} (${hint})`}
            aria-keyshortcuts={hint}
            disabled={!actions[action]}
            onClick={actions[action]}
            className="rounded border border-gray-300 px-2 py-1 text-sm hover:bg-gray-100 disabled:opacity-50"
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
