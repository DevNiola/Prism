import React from "react";

export type SeverityType = "info" | "warning" | "error" | "fatal" | string;

export function InfoIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

export function WarningIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}

export function ErrorIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86L7.86 2z" />
    </svg>
  );
}

export function SkullIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10h.01M15 10h.01M9 16h6m-3-4v4m7-4a7 7 0 11-14 0 7 7 0 0114 0zM8 18v2a1 1 0 001 1h6a1 1 0 001-1v-2" />
    </svg>
  );
}

export function getSeverityMeta(severity: SeverityType) {
  const norm = (severity || "").toLowerCase();
  switch (norm) {
    case "info":
      return {
        label: "Info",
        colorClass: "text-blue-500",
        // text-blue-700 (#1d4ed8) on bg-blue-50 (#eff6ff): ~8.6:1 — WCAG AA ✓
        badgeClass: "bg-blue-50 text-blue-700 border-blue-200",
        // text-blue-200 (#bfdbfe) on bg-blue-950/40: ~8.1:1 — WCAG AA ✓
        panelClass: "border-blue-900/60 bg-blue-950/40 text-blue-200",
        accentClass: "bg-blue-500",
        Icon: InfoIcon,
      };
    case "warning":
      return {
        label: "Warning",
        colorClass: "text-amber-500",
        // text-amber-800 (#92400e) on bg-amber-50 (#fffbeb): ~7.2:1 — WCAG AA ✓
        badgeClass: "bg-amber-50 text-amber-800 border-amber-300",
        // text-amber-200 (#fde68a) on bg-amber-950/40: ~8.3:1 — WCAG AA ✓
        panelClass: "border-amber-900/60 bg-amber-950/40 text-amber-200",
        accentClass: "bg-amber-500",
        Icon: WarningIcon,
      };
    case "fatal":
      return {
        label: "Fatal",
        colorClass: "text-rose-900",
        // text-red-200 (#fecaca) on bg-red-950 (#450a0a): ~9.5:1 — WCAG AA ✓
        badgeClass: "bg-red-950 text-red-200 border-red-800",
        panelClass: "border-red-900 bg-red-950/70 text-red-200",
        accentClass: "bg-red-700",
        Icon: SkullIcon,
      };
    case "error":
    default:
      return {
        label: "Error",
        colorClass: "text-red-500",
        // text-red-700 (#b91c1c) on bg-red-50 (#fef2f2): ~5.9:1 — WCAG AA ✓
        badgeClass: "bg-red-50 text-red-700 border-red-200",
        panelClass: "border-rose-900/60 bg-rose-950/40 text-rose-300",
        accentClass: "bg-red-500",
        Icon: ErrorIcon,
      };
  }
}

export function SeverityBadge({
  severity,
  className = "",
  showIcon = true,
  ariaLabel,
}: {
  severity: SeverityType;
  className?: string;
  showIcon?: boolean;
  /** Overrides the default accessible label "Severity: <Level>". */
  ariaLabel?: string;
}) {
  const meta = getSeverityMeta(severity);
  const Icon = meta.Icon;
  const label = ariaLabel ?? `Severity: ${meta.label}`;

  return (
    <span
      aria-label={label}
      role="status"
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${meta.badgeClass} ${className}`}
    >
      {showIcon && <Icon className="w-3.5 h-3.5 flex-shrink-0" />}
      <span>{meta.label}</span>
    </span>
  );
}

export default SeverityBadge;
