import { useId } from "react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description: string;
  illustration?: ReactNode;
  action?: ReactNode;
}

export default function EmptyState({
  title,
  description,
  illustration,
  action,
}: EmptyStateProps) {
  const titleId = useId();
  return (
    <section
      className="mx-auto max-w-3xl border-t border-current/10 px-4 py-10 text-center"
      aria-labelledby={titleId}
    >
      {illustration && (
        <div aria-hidden="true" className="mx-auto mb-4 flex justify-center">
          {illustration}
        </div>
      )}
      <h2 id={titleId} className="text-lg font-semibold">
        {title}
      </h2>
      <p className="mx-auto mt-2 max-w-lg text-sm opacity-70">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </section>
  );
}