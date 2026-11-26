import React from "react";

interface SkeletonFadeProps {
  /** The skeleton placeholder, shown while loading. */
  skeleton: React.ReactNode;
  /** The real content, shown once loaded. */
  children: React.ReactNode;
  /** Whether the content is still loading. */
  loading: boolean;
}

/**
 * Wraps a skeleton and its loaded content in a crossfade transition.
 * Both skeleton and content occupy the same space; opacity transitions
 * between them using `transition-opacity duration-300`.
 */
export function SkeletonFade({ skeleton, children, loading }: SkeletonFadeProps) {
  return (
    <div className="relative">
      <div
        className={`transition-opacity duration-300 ${loading ? "opacity-100" : "opacity-0 pointer-events-none absolute inset-0"}`}
        aria-hidden={!loading}
      >
        {skeleton}
      </div>
      <div
        className={`transition-opacity duration-300 ${loading ? "opacity-0 pointer-events-none absolute inset-0" : "opacity-100"}`}
      >
        {children}
      </div>
    </div>
  );
}

interface SkeletonProps {
  /** Extra classes used to size and position the placeholder (e.g. `h-4 w-32`). */
  className?: string;
  /** Surface the placeholder sits on; controls the pulse colour. */
  tone?: "light" | "dark";
}

const toneClass: Record<NonNullable<SkeletonProps["tone"]>, string> = {
  light: "bg-gray-200",
  dark: "bg-gray-700",
};

/**
 * A single placeholder block. Every skeleton variant is composed from this so
 * the pulse animation, rounding and reduced-motion handling stay consistent.
 *
 * Skeletons are decorative and hidden from assistive technology; the component
 * that owns the loading state announces it with `aria-busy`.
 */
export default function Skeleton({
  className = "",
  tone = "light",
}: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded ${toneClass[tone]} motion-reduce:animate-none ${className}`}
    />
  );
}

/** Repeats a placeholder `count` times, useful for list-shaped skeletons. */
export function SkeletonList({
  count,
  className = "",
  tone,
}: {
  count: number;
  className?: string;
  tone?: SkeletonProps["tone"];
}) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className={className} tone={tone} />
      ))}
    </>
  );
}
