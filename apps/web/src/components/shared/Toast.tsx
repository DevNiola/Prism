"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastType = "success" | "error" | "info";

export interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

export interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
  dismissToast: (id: number) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

interface ToastProviderProps {
  children: ReactNode;
}

const TOAST_DURATION_MS = 4000;

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismissToast = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = "info") => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, message, type }]);
      timers.current.set(
        id,
        setTimeout(() => dismissToast(id), TOAST_DURATION_MS),
      );
    },
    [dismissToast],
  );

  useEffect(
    () => () => {
      timers.current.forEach((timer) => clearTimeout(timer));
      timers.current.clear();
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[120] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        aria-label="Notifications"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.type === "error" ? "alert" : "status"}
            aria-live={toast.type === "error" ? "assertive" : "polite"}
            className={`pointer-events-auto flex items-start justify-between gap-4 rounded-md border px-4 py-3 text-sm shadow-lg ${
              toast.type === "error"
                ? "border-red-300 bg-red-50 text-red-900"
                : toast.type === "success"
                  ? "border-green-300 bg-green-50 text-green-900"
                  : "border-sky-300 bg-sky-50 text-sky-900"
            }`}
          >
            <span>{toast.message}</span>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss notification"
              className="shrink-0 font-semibold leading-none"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}