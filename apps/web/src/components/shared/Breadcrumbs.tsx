"use client";

import { useState } from "react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

/** Returns true when the string looks like a 64-char hex transaction hash. */
function isTxHash(value: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(value);
}

/** Truncates a 64-char hash to first8…last6, e.g. "abcd1234…ef5678". */
function truncateHash(hash: string): string {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard not available (e.g. non-secure context) — silently ignore
    }
  }

  return (
    <button
      onClick={handleCopy}
      aria-label="Copy full transaction hash"
      title={copied ? "Copied!" : "Copy full hash"}
      className="ml-1 inline-flex items-center rounded px-1 py-0.5 text-[10px] text-white/40 transition-colors hover:bg-white/10 hover:text-white/80 focus:outline-none focus:ring-1 focus:ring-white/20"
    >
      {copied ? (
        // Checkmark
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-3 w-3 text-green-400"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        // Clipboard icon
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-3 w-3"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
          <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
        </svg>
      )}
    </button>
  );
}

function HashCrumb({ hash }: { hash: string }) {
  const [hovered, setHovered] = useState(false);

  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      <span className="font-mono text-white/80">{truncateHash(hash)}</span>
      <CopyButton value={hash} />

      {/* Full-hash tooltip */}
      {hovered && (
        <span
          role="tooltip"
          className="absolute left-0 top-6 z-50 max-w-xs break-all rounded-lg border border-white/10 bg-[#1a1d27] px-3 py-2 font-mono text-[10px] text-white/80 shadow-xl"
        >
          {hash}
        </span>
      )}
    </span>
  );
}

export default function Breadcrumbs({ items }: BreadcrumbsProps) {
  if (!items || items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-white/50">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        const isHash = isTxHash(item.label);

        const content = isHash ? (
          <HashCrumb hash={item.label} />
        ) : (
          <span className={isLast ? "text-white/90" : ""}>{item.label}</span>
        );

        return (
          <span key={i} className="inline-flex items-center gap-1">
            {i > 0 && (
              <span aria-hidden="true" className="select-none text-white/20">
                /
              </span>
            )}
            {item.href && !isLast ? (
              <a
                href={item.href}
                className="transition-colors hover:text-white/80"
              >
                {content}
              </a>
            ) : (
              content
            )}
          </span>
        );
      })}
    </nav>
  );
}
