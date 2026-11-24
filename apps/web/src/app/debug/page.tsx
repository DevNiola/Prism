"use client";

import BreakpointManager from "@/components/debug/BreakpointManager";

export default function DebugPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center px-4 py-16 gap-8">
      <section className="text-center max-w-2xl mx-auto">
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-slate-100 via-violet-200 to-violet-400 bg-clip-text text-transparent mb-3">
          Interactive Debugger
        </h1>
        <p className="text-slate-400">
          Set, group, and reorder breakpoints to control execution replay.
        </p>
      </section>

      <div className="w-full max-w-2xl">
        <BreakpointManager />
      </div>
    </main>
  );
}
