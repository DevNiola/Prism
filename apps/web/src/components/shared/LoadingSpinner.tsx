interface LoadingSpinnerProps {
  /** Accessible label for screen readers. Defaults to "Loading…" */
  label?: string;
  /** Size of the spinner in pixels. Defaults to 24. */
  size?: number;
}

export default function LoadingSpinner({
  label = "Loading…",
  size = 24,
}: LoadingSpinnerProps) {
  return (
    <span role="status" aria-label={label} className="inline-flex">
      <svg
        aria-hidden="true"
        className="animate-spin text-violet-400"
        width={size}
        height={size}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}
