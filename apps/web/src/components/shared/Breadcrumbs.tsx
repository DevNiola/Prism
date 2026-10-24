import React from "react";
import Link from "next/link";

export interface BreadcrumbItem {
  label: string;
  href?: string;
  current?: boolean;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumbs({ items, className = "" }: BreadcrumbsProps) {
  if (!items || items.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb navigation" className={`flex items-center text-sm text-gray-500 py-2 ${className}`}>
      <ol className="flex flex-wrap items-center space-x-2">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          const isCurrent = item.current || isLast;

          return (
            <li key={idx} className="flex items-center space-x-2">
              {idx > 0 && (
                <span className="text-gray-400 select-none" aria-hidden="true">
                  /
                </span>
              )}
              {item.href && !isCurrent ? (
                <Link
                  href={item.href}
                  className="font-medium text-blue-600 hover:text-blue-800 hover:underline transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-1"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={
                    isCurrent
                      ? "font-semibold text-gray-900 bg-gray-100 px-2 py-0.5 rounded text-xs tracking-wide"
                      : "text-gray-600"
                  }
                  aria-current={isCurrent ? "page" : undefined}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default Breadcrumbs;
