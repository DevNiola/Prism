"use client";

import React, { Component, type ReactNode, type ErrorInfo } from "react";
import { reloadWasm } from "@/lib/wasm";

export interface FallbackProps {
  error: Error;
  resetErrorBoundary: () => void;
  isWasmError: boolean;
  onReloadWasm?: () => Promise<void>;
  isReloading?: boolean;
}

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Custom fallback component, element, or render function */
  fallback?: ReactNode | ((props: FallbackProps) => ReactNode);
  /** Callback fired when the error boundary resets */
  onReset?: () => void;
  /** Callback fired when an error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Explicitly flag whether this boundary wraps a WASM-dependent component */
  isWasm?: boolean;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  isReloading: boolean;
}

/**
 * Checks whether an error is likely caused by a WebAssembly loading/initialization failure.
 */
export function isWasmError(error: Error | null): boolean {
  if (!error) return false;
  if (error.name === "WasmLoadError") return true;
  const message = (error.message || "").toLowerCase();
  const name = (error.name || "").toLowerCase();
  return (
    name.includes("wasm") ||
    message.includes("wasm") ||
    message.includes("webassembly")
  );
}

/**
 * Reusable Error Boundary Fallback for WASM load failures.
 */
export function WasmFallback({
  error,
  resetErrorBoundary,
  onReloadWasm,
  isReloading,
}: FallbackProps) {
  return (
    <div
      role="alert"
      className="bg-slate-900 border border-red-900/50 rounded-xl p-6 shadow-xl max-w-3xl mx-auto my-6 text-slate-100 animate-in fade-in duration-300"
    >
      <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden="true">
            ⚠️
          </span>
          <div>
            <h3 className="text-lg font-bold text-red-400">
              WebAssembly Module Failed to Load
            </h3>
            <p className="text-xs text-slate-400">
              The required WASM runtime could not be initialized.
            </p>
          </div>
        </div>
        <span className="text-xs px-2.5 py-1 rounded-full bg-red-950/60 border border-red-800/60 text-red-400 font-mono">
          WasmLoadError
        </span>
      </div>

      <div className="space-y-4 mb-6">
        <p className="text-sm text-slate-300 leading-relaxed">
          This component relies on Prism&apos;s WebAssembly engine to decode contract
          errors and parse contract specifications. The WASM bundle failed to load,
          which may be caused by network connectivity issues or an unsupported browser environment.
        </p>

        <div className="bg-slate-950 rounded-lg p-3 border border-slate-800 text-xs font-mono text-red-300/90 break-all">
          <span className="text-slate-500 select-none">$ error: </span>
          {error.message || "Unknown error during WASM initialization"}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {onReloadWasm && (
          <button
            type="button"
            onClick={onReloadWasm}
            disabled={isReloading}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800/50 text-white rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 shadow-lg shadow-violet-900/20 cursor-pointer disabled:cursor-not-allowed"
          >
            {isReloading ? (
              <>
                <svg
                  className="animate-spin h-4 w-4 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8H4z"
                  />
                </svg>
                <span>Reloading WASM...</span>
              </>
            ) : (
              <>
                <span aria-hidden="true">🔄</span>
                <span>Reload WASM</span>
              </>
            )}
          </button>
        )}

        <button
          type="button"
          onClick={resetErrorBoundary}
          disabled={isReloading}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 border border-slate-700 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:cursor-not-allowed"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}

/**
 * Default fallback for non-WASM general component failures.
 */
export function DefaultFallback({
  error,
  resetErrorBoundary,
}: FallbackProps) {
  return (
    <div
      role="alert"
      className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-xl max-w-3xl mx-auto my-6 text-slate-100"
    >
      <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-4">
        <h3 className="text-lg font-bold text-amber-400 flex items-center gap-2">
          <span>⚠️</span> Something went wrong
        </h3>
        <span className="text-xs px-2.5 py-1 rounded bg-amber-950/40 border border-amber-800/50 text-amber-400 font-mono">
          Component Error
        </span>
      </div>

      <p className="text-sm text-slate-400 mb-4">
        An error occurred while displaying this section. You can try refreshing or resetting the view.
      </p>

      <div className="bg-slate-950 rounded-lg p-3 border border-slate-800 text-xs font-mono text-red-300 mb-6 break-all">
        {error.message || "Unknown error"}
      </div>

      <button
        type="button"
        onClick={resetErrorBoundary}
        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-sm font-medium transition-colors cursor-pointer"
      >
        Try Again
      </button>
    </div>
  );
}

/**
 * A reusable React Error Boundary designed to gracefully catch component errors,
 * with first-class handling and fallbacks for WASM loading failures.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      isReloading: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  resetErrorBoundary = (): void => {
    if (this.props.onReset) {
      this.props.onReset();
    }
    this.setState({
      hasError: false,
      error: null,
      isReloading: false,
    });
  };

  handleReloadWasm = async (): Promise<void> => {
    this.setState({ isReloading: true });
    try {
      await reloadWasm();
      this.resetErrorBoundary();
    } catch (err) {
      this.setState({
        isReloading: false,
        error:
          err instanceof Error
            ? err
            : new Error(String(err) || "Failed to reload WASM module"),
      });
    }
  };

  render(): ReactNode {
    const { hasError, error, isReloading } = this.state;
    const { children, fallback, isWasm } = this.props;

    if (hasError && error) {
      const isWasmFailure = Boolean(isWasm || isWasmError(error));

      const fallbackProps: FallbackProps = {
        error,
        resetErrorBoundary: this.resetErrorBoundary,
        isWasmError: isWasmFailure,
        onReloadWasm: isWasmFailure ? this.handleReloadWasm : undefined,
        isReloading,
      };

      if (typeof fallback === "function") {
        return fallback(fallbackProps);
      }

      if (fallback) {
        return fallback;
      }

      if (isWasmFailure) {
        return <WasmFallback {...fallbackProps} />;
      }

      return <DefaultFallback {...fallbackProps} />;
    }

    return children;
  }
}

/**
 * Higher-Order Component helper to wrap any component in an ErrorBoundary.
 */
export function withErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, "children">
): React.FC<P> {
  const ComponentWithErrorBoundary: React.FC<P> = (props: P) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <WrappedComponent {...props} />
    </ErrorBoundary>
  );

  const displayName =
    WrappedComponent.displayName || WrappedComponent.name || "Component";
  ComponentWithErrorBoundary.displayName = `withErrorBoundary(${displayName})`;

  return ComponentWithErrorBoundary;
}

export default ErrorBoundary;
