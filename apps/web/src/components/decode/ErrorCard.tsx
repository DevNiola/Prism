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

  const handleExportJson = () => {
    const txHash = report.transaction_context?.tx_hash || "diagnostic";
    const filename = `${txHash}-report.json`;
    const jsonStr = JSON.stringify(report, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportMarkdown = () => {
    const txHash = report.transaction_context?.tx_hash || "diagnostic";
    const filename = `${txHash}-report.md`;
    let md = `# Diagnostic Report: ${report.error_name}\n\n`;
    md += `- **Category**: ${report.error_category}\n`;
    md += `- **Code**: ${report.error_code}\n`;
    md += `- **Severity**: ${report.severity}\n`;
    if (report.transaction_context?.tx_hash) {
      md += `- **Transaction Hash**: \`${report.transaction_context.tx_hash}\`\n`;
    }
    md += `\n## Summary\n\n${report.summary}\n\n`;
    if (report.detailed_explanation) {
      md += `## Detailed Explanation\n\n${report.detailed_explanation}\n\n`;
    }
    if (report.root_causes && report.root_causes.length > 0) {
      md += `## Root Causes\n\n`;
      report.root_causes.forEach((rc, i) => {
        md += `${i + 1}. **${rc.likelihood}**: ${rc.description}\n`;
      });
      md += `\n`;
    }
    if (report.suggested_fixes && report.suggested_fixes.length > 0) {
      md += `## Suggested Fixes\n\n`;
      report.suggested_fixes.forEach((fix, i) => {
        md += `### ${i + 1}. ${fix.description} (${fix.difficulty})\n\n`;
        if (fix.example) {
          md += `\`\`\`rust\n${fix.example}\n\`\`\`\n\n`;
        }
      });
    }
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

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
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={report.severity} />
            <button
              type="button"
              onClick={handleExportJson}
              className="inline-flex items-center gap-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 px-2.5 py-1 text-xs font-medium transition-colors"
              title="Download diagnostic report as JSON"
            >
              Export JSON
            </button>
            <button
              type="button"
              onClick={handleExportMarkdown}
              className="inline-flex items-center gap-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 px-2.5 py-1 text-xs font-medium transition-colors"
              title="Download diagnostic report as Markdown"
            >
              Export MD
            </button>
          </div>
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

export function ErrorCardSkeleton({
  txHash,
  indicatorText = "Decoding transaction...",
}: {
  txHash?: string;
  indicatorText?: string;
}) {
  return (
    <article
      aria-busy="true"
      aria-label="Loading diagnostic report"
      className="overflow-hidden rounded-xl border border-violet-800/40 bg-slate-900 shadow-xl transition-all animate-pulse"
    >
      <div className="border-b border-slate-800 bg-slate-950/40 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-violet-400 animate-ping" />
              <span className="text-xs font-semibold uppercase tracking-wider text-violet-400">
                {indicatorText}
              </span>
            </div>
            <div className="h-7 w-64 rounded bg-slate-800" />
            {txHash && (
              <p className="font-mono text-xs text-slate-500">
                Hash: {txHash}
              </p>
            )}
          </div>
          <div className="h-6 w-24 rounded bg-slate-800" />
        </div>
      </div>

      <div className="space-y-6 p-6">
        <div className="space-y-2">
          <div className="h-4 w-3/4 rounded bg-slate-800" />
          <div className="h-4 w-1/2 rounded bg-slate-800/70" />
        </div>

        <div className="rounded-lg border border-slate-800/80 bg-slate-950/30 p-4 space-y-3">
          <div className="h-4 w-1/3 rounded bg-slate-800" />
          <div className="h-3 w-5/6 rounded bg-slate-800/60" />
          <div className="h-3 w-4/6 rounded bg-slate-800/60" />
        </div>
      </div>
    </article>
  );
}
