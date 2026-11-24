"use client";

import { useSyncExternalStore } from "react";

export type ToastType = "success" | "error" | "info" | "warning";

export interface UndoAction {
  label: string;
  run: () => void;
}

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  /** Auto-dismiss delay in ms. 0 keeps the toast sticky (no countdown). */
  duration: number;
  undo?: UndoAction;
}

export interface ToastInput {
  message: string;
  type?: ToastType;
  duration?: number;
  undo?: UndoAction;
}

const MAX_TOASTS = 5;

let toasts: ToastItem[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function addToast(input: ToastInput): string {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const item: ToastItem = {
    id,
    message: input.message,
    type: input.type ?? "info",
    duration: input.duration ?? 5000,
    undo: input.undo,
  };
  toasts = [...toasts, item].slice(-MAX_TOASTS);
  emit();
  return id;
}

export function dismiss(id: string) {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/**
 * Imperative toast API. The ToastContainer (mounted once in the root layout)
 * subscribes to these via `useToasts` and renders them; any component can fire
 * toasts without prop-drilling.
 *
 *   toast.success("Saved")
 *   toast.error("Reverted", { undo: { label: "Undo", run: restore } })
 */
export const toast = {
  show: addToast,
  success: (message: string, opts?: Omit<ToastInput, "message" | "type">) =>
    addToast({ ...opts, message, type: "success" }),
  error: (message: string, opts?: Omit<ToastInput, "message" | "type">) =>
    addToast({ ...opts, message, type: "error" }),
  info: (message: string, opts?: Omit<ToastInput, "message" | "type">) =>
    addToast({ ...opts, message, type: "info" }),
  warning: (message: string, opts?: Omit<ToastInput, "message" | "type">) =>
    addToast({ ...opts, message, type: "warning" }),
  dismiss,
};

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot() {
  return toasts;
}

/** Read the current toast stack; re-renders when toasts are added/removed. */
export function useToasts(): ToastItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
