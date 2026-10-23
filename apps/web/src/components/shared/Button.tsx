import React from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style variant */
  variant?: ButtonVariant;
  /** Size of the button */
  size?: ButtonSize;
  /** Show a loading spinner and disable interactions */
  loading?: boolean;
  /** Icon rendered before the label */
  iconLeft?: React.ReactNode;
  /** Icon rendered after the label */
  iconRight?: React.ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-violet-600 hover:bg-violet-500 active:bg-violet-700 text-white border border-transparent focus-visible:ring-violet-500",
  secondary:
    "bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-100 border border-slate-700 focus-visible:ring-slate-500",
  ghost:
    "bg-transparent hover:bg-slate-800 active:bg-slate-900 text-slate-300 border border-transparent focus-visible:ring-slate-500",
  danger:
    "bg-red-700 hover:bg-red-600 active:bg-red-800 text-white border border-transparent focus-visible:ring-red-500",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs rounded-md gap-1.5",
  md: "px-5 py-2.5 text-sm rounded-lg gap-2",
  lg: "px-7 py-3 text-base rounded-xl gap-2.5",
};

/**
 * Reusable Button component.
 *
 * @example
 * <Button variant="primary" size="md" onClick={handleClick}>
 *   Submit
 * </Button>
 *
 * @example
 * <Button variant="danger" loading>Deleting…</Button>
 */
export default function Button({
  variant = "primary",
  size = "md",
  loading = false,
  iconLeft,
  iconRight,
  disabled,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      disabled={isDisabled}
      aria-disabled={isDisabled}
      aria-busy={loading}
      className={[
        // Base styles
        "inline-flex items-center justify-center font-medium",
        "transition-colors duration-150",
        // Focus ring
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950",
        // Variant
        variantClasses[variant],
        // Size
        sizeClasses[size],
        // Disabled / loading
        isDisabled ? "opacity-50 cursor-not-allowed pointer-events-none" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {loading ? (
        <>
          {/* Spinner */}
          <svg
            aria-hidden="true"
            className="animate-spin shrink-0"
            style={{ width: size === "sm" ? 12 : size === "lg" ? 18 : 15, height: size === "sm" ? 12 : size === "lg" ? 18 : 15 }}
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
          {children && <span>{children}</span>}
        </>
      ) : (
        <>
          {iconLeft && (
            <span aria-hidden="true" className="shrink-0">
              {iconLeft}
            </span>
          )}
          {children && <span>{children}</span>}
          {iconRight && (
            <span aria-hidden="true" className="shrink-0">
              {iconRight}
            </span>
          )}
        </>
      )}
    </button>
  );
}
