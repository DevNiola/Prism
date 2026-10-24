"use client";

import type { DiagnosticReport } from "@/lib/types";
import SuggestedFixes from "./SuggestedFixes";
import { SeverityBadge, getSeverityMeta } from "@/components/shared/SeverityBadge";

interface ErrorCardProps {
  report: DiagnosticReport;
}

export default function ErrorCard({ report }: ErrorCardProps) {
  const meta = getSeverityMeta(report.severity);
  const SeverityIcon = meta.Icon;

  return (
    <article className="mx-auto my-6 max-w-3xl overflow-hidden rounded-lg border border-slate-800 bg-slate-900 text-slate-100 shadow-xl">
      <header className={`relative border-b p-5 sm:p-6 ${meta.panelClass}`}>
        <span
          aria-hidden="true"
          className={`absolute inset-y-0 left-0 w-1 ${meta.accentClass}`}
        />
        <div className="flex flex-wrap items-start justify-between gap-4 pl-2">
          <div>
            <p className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider ${meta.colorClass}`}>
              <SeverityIcon className="w-4 h-4" />
              <span>{report.severity} severity · {report.error_category}</span>
            </p>
            <h2 className="mt-2 text-2xl font-bold text-slate-50">
              {report.error_name}
            </h2>
            <p className="mt-1 font-mono text-xs text-slate-400">
              Error code {report.error_code}
            </p>
          </div>
          <SeverityBadge severity={report.severity} />
        </div>
        <p className="mt-5 pl-2 text-base leading-relaxed text-slate-100">
          {report.summary}
        </p>
      </header>
      <div className="space-y-7 p-5 sm:p-6">
        <section aria-labelledby="error-explanation-heading">
          <h3 id="error-explanation-heading" className="text-xs font-bold uppercase tracking-wider text-slate-500">
            What happened
          </h3>
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-300">
            {report.detailed_explanation}
          </p>
        </section>

        <section aria-labelledby="root-causes-heading">
          <details className="group rounded border border-slate-800 bg-slate-950/60">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <span>
                <span id="root-causes-heading" className="block text-sm font-semibold text-slate-100">
                  Root causes
                </span>
                <span className="mt-1 block text-xs text-slate-500">
                  {report.root_causes?.length ?? 0} possible causes
                </span>
              </span>
              <span aria-hidden="true" className="text-slate-400 transition-transform group-open:rotate-180">
                ⌄
              </span>
            </summary>
            <div className="border-t border-slate-800 px-4 py-4">
              {report.root_causes?.length ? (
                <ol className="space-y-4">
                  {report.root_causes.map((cause, index) => (
                    <li key={`${cause.description}-${index}`} className="flex gap-3">
                      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-950 text-xs font-semibold text-amber-300">
                        {index + 1}
                      </span>
                      <div>
                        <p className="text-sm leading-relaxed text-slate-200">
                          {cause.description}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Likelihood: {cause.likelihood}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-slate-500">
                  No root causes are documented for this error.
                </p>
              )}
            </div>
          </details>
        </section>

        <SuggestedFixes fixes={report.suggested_fixes ?? []} />
      </div>
    </article>
  );
}
