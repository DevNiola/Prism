import type { ReactNode } from "react";

interface ExampleHash {
  label: string;
  hash: string;
  description: string;
}

interface EmptyStateProps {
  title: string;
  description: string;
  illustration: ReactNode;
  action: ReactNode;
  /** Optional list of example transaction hashes shown as quick-load chips. */
  examples?: ExampleHash[];
  onExampleClick?: (hash: string) => void;
}

export default function EmptyState({
  title,
  description,
  illustration,
  action,
  examples,
  onExampleClick,
}: EmptyStateProps) {
  return (
    <section
      className="mx-auto max-w-3xl border-t border-current/10 px-4 py-10 text-center"
      aria-labelledby="empty-state-title"
    >
      <div aria-hidden="true" className="mx-auto mb-4 flex justify-center">
        {illustration}
      </div>
      <h2 id="empty-state-title" className="text-lg font-semibold">
        {title}
      </h2>
      <p className="mx-auto mt-2 max-w-lg text-sm opacity-70">{description}</p>
      <div className="mt-5">{action}</div>
      {examples && examples.length > 0 && (
        <div className="mt-6">
          <p className="text-xs font-medium opacity-50 mb-3 uppercase tracking-wider">
            Try a sample failure
          </p>
          <ul className="flex flex-wrap justify-center gap-2" role="list">
            {examples.map((ex) => (
              <li key={ex.hash}>
                <button
                  type="button"
                  onClick={() => onExampleClick?.(ex.hash)}
                  title={ex.description}
                  className="rounded-full border border-current/20 px-3 py-1 text-xs font-mono hover:bg-current/5 transition-colors focus-visible:ring-2 focus-visible:ring-current/40"
                  aria-label={`Load example: ${ex.label}`}
                >
                  {ex.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
