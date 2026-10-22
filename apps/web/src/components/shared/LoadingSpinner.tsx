interface LoadingSpinnerProps {
  /** Accessible label announced while the indeterminate load is in flight. */
  label?: string;
  className?: string;
}

/**
 * Indeterminate progress indicator. Prefer a skeleton variant when the shape of
 * the incoming content is known — use this only as the fallback for loads whose
 * layout cannot be predicted ahead of time.
 */
export default function LoadingSpinner({
  label = "Loading",
  className = "",
}: LoadingSpinnerProps) {
  return (
    <span role="status" aria-label={label} className={`spinner ${className}`}>
      <span className="sr-only">{label}</span>
    </span>
  );
}
