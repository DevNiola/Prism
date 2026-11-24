"use client";

import type { DiagnosticReport } from "@/lib/types";

interface ErrorCardProps {
  report: DiagnosticReport;
}

export default function ErrorCard({ report }: ErrorCardProps) {
  const getSeverityStyles = (severity: string) => {
    switch (severity.toLowerCase()) {
      case "fatal":
        return "bg-destructive/15 border-destructive/30 text-destructive";
      case "error":
        return "bg-destructive/15 border-destructive/30 text-destructive";
      case "warning":
        return "bg-warning/15 border-warning/30 text-warning";
      case "info":
        return "bg-info/15 border-info/30 text-info";
      default:
        return "bg-muted/40 border-border text-muted-foreground";
    }
  };

  return (
    <div className="card-interactive bg-card border border-border rounded-xl p-6 shadow-xl max-w-3xl mx-auto my-6 text-card-foreground">
      <div className="flex items-start justify-between mb-4">
        <div>
          <span className="text-xs font-bold text-primary uppercase tracking-wider">
            Category: {report.error_category}
          </span>
          <h3 className="text-xl font-bold text-card-foreground flex items-center gap-2 mt-1">
            {report.error_name}
            <span className="text-sm font-mono text-muted-foreground bg-background px-2 py-0.5 rounded border border-border">
              Code {report.error_code}
            </span>
          </h3>
        </div>
        <span
          className={`text-xs px-2.5 py-1 rounded border font-medium ${getSeverityStyles(report.severity)}`}
        >
          {report.severity.toUpperCase()}
        </span>
      </div>

      <div className="bg-background rounded-lg p-4 border border-border mb-6">
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
          Summary
        </h4>
        <p className="text-card-foreground text-sm">{report.summary}</p>
      </div>

      <div className="mb-6">
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
          Detailed Explanation
        </h4>
        <p className="text-muted-foreground text-sm leading-relaxed whitespace-pre-line">
          {report.detailed_explanation}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6 border-t border-border pt-6">
        <div>
          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
            Common Causes
          </h4>
          {report.root_causes && report.root_causes.length > 0 ? (
            <ul className="space-y-3">
              {report.root_causes.map((cause, i) => (
                <li
                  key={i}
                  className="text-sm text-card-foreground flex items-start gap-2"
                >
                  <span className="text-destructive mt-1">•</span>
                  <div>
                    <p>{cause.description}</p>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">
                      Likelihood: {cause.likelihood}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No common causes documented.
            </p>
          )}
        </div>

        <div>
          <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
            Suggested Fixes
          </h4>
          {report.suggested_fixes && report.suggested_fixes.length > 0 ? (
            <ul className="space-y-3">
              {report.suggested_fixes.map((fix, i) => (
                <li
                  key={i}
                  className="text-sm text-card-foreground flex items-start gap-2"
                >
                  <span className="text-success mt-1">✓</span>
                  <div>
                    <p>{fix.description}</p>
                    <div className="flex gap-2 mt-1">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">
                        Difficulty: {fix.difficulty}
                      </span>
                      {fix.requires_upgrade && (
                        <span className="text-[10px] text-warning uppercase tracking-wider font-mono">
                          Requires Upgrade
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No suggested fixes documented.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
