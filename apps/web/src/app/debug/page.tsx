import EmptyState from "@/components/shared/EmptyState";

export default function DebugPage() {
  return (
    <main className="container mx-auto p-6">
      <h1 className="mb-2 text-3xl font-bold">Interactive Debugger</h1>
      <EmptyState
        title="Start with an execution trace"
        description="Load a transaction in Trace to inspect its execution steps and state changes."
        illustration={
          <svg viewBox="0 0 160 112" className="h-28 w-40" fill="none">
            <rect x="25" y="20" width="110" height="72" rx="7" stroke="currentColor" strokeWidth="2" />
            <path d="M25 38h110" stroke="currentColor" strokeWidth="2" />
            <circle cx="37" cy="29" r="2" fill="#fb7185" />
            <circle cx="45" cy="29" r="2" fill="#fbbf24" />
            <circle cx="53" cy="29" r="2" fill="#34d399" />
            <path d="m43 55 8 6-8 6M58 67h17" stroke="#34d399" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
            <path d="M89 53h27M89 63h19M89 73h23" stroke="currentColor" strokeLinecap="round" strokeWidth="2" opacity=".4" />
          </svg>
        }
        action={
          <a
            href="/trace"
            className="inline-flex rounded-md border border-emerald-600/50 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
          >
            Open Execution Trace
          </a>
        }
      />
    </main>
  );
}
