"use client";

import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const route =
      typeof window !== "undefined" ? window.location.pathname : "unknown";
    const errorClass = this.state.error?.name ?? "Error";

    const bugBody = [
      `**Page / Route**\n${route}`,
      `**Error class**\n${errorClass}`,
      `**Steps to reproduce**\n1. `,
      `**Expected behaviour**\n`,
      `**Actual behaviour**\n`,
    ].join("\n\n");

    const bugReportUrl =
      `https://github.com/DevNiola/Prism/issues/new` +
      `?template=bug_report.md` +
      `&title=${encodeURIComponent(`[Bug] ${errorClass} on ${route}`)}` +
      `&body=${encodeURIComponent(bugBody)}`;

    return (
      <>
        <header className="border-b border-white/10 bg-[#0f1117] px-6 py-4">
          <nav>
            <span className="text-lg font-semibold text-white">🔬 Prism</span>
          </nav>
        </header>

        <main className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 text-center">
          <div className="max-w-md w-full rounded-2xl border border-red-500/30 bg-red-500/10 p-8 shadow-lg">
            <h1 className="mb-2 text-2xl font-bold text-red-400">
              Something went wrong
            </h1>
            <p className="mb-6 text-sm text-gray-400">
              An unexpected error occurred. You can try again or let us know so
              we can fix it.
            </p>

            {this.state.error && (
              <p className="mb-6 rounded bg-black/40 px-3 py-2 font-mono text-xs text-red-300">
                {this.state.error.name}: {this.state.error.message}
              </p>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                onClick={this.handleReset}
                className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                Try again
              </button>

              <a
                href={bugReportUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-white/20 px-5 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-white/20"
              >
                Report this bug
              </a>
            </div>
          </div>
        </main>

        <footer className="border-t border-white/10 bg-[#0f1117] px-6 py-4 text-center text-xs text-gray-500">
          Prism — Soroban Transaction Debugger
        </footer>
      </>
    );
  }
}
