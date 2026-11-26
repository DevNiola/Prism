"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Skeleton from "@/components/shared/Skeleton";
import { getBudgetThresholds } from "@/lib/api";
import type { BudgetThresholds, ResourceProfileResponse } from "@/lib/api";

interface ResourceProfileProps {
  profile?: ResourceProfileResponse | null;
  loading?: boolean;
}

function ResourceBar({
  label,
  used,
  limit,
  threshold,
  unit,
}: {
  label: string;
  used?: number;
  limit?: number;
  threshold: number;
  unit: string;
}) {
  if (used === undefined && limit === undefined) return null;

  const percent = used !== undefined && limit !== undefined && limit > 0
    ? (used / limit) * 100
    : undefined;
  const color = percent === undefined ? "#9ca3af"
    : percent >= 100 ? "#dc2626"
    : percent >= threshold ? "#d97706"
    : "#059669";
  const chartUsed = Math.min(percent ?? 0, 100);
  const exact = (value?: number) => value === undefined
    ? "Unavailable"
    : `${value.toLocaleString()} ${unit}`;
  const status = percent === undefined ? "Usage percentage unavailable"
    : `${percent.toFixed(1)}%${percent >= 100 ? " · At or over limit" : percent >= threshold ? " · Warning" : ""}`;

  return (
    <div role="group" aria-label={`${label}: ${exact(used)} used, ${exact(limit)} limit`}>
      <div className="flex flex-wrap justify-between gap-x-2 text-sm">
        <span className="font-semibold text-gray-800">{label}</span>
        <span className="text-gray-600">{status}</span>
      </div>
      <ResponsiveContainer width="100%" height={24}>
        <BarChart
          data={[{ used: chartUsed, remaining: percent === undefined ? 0 : 100 - chartUsed }]}
          layout="vertical"
          margin={{ top: 0, bottom: 0, left: 0, right: 0 }}
          accessibilityLayer
        >
          <XAxis type="number" domain={[0, 100]} hide />
          <YAxis type="category" hide />
          <Tooltip
            cursor={false}
            allowEscapeViewBox={{ y: true }}
            wrapperStyle={{ zIndex: 1 }}
            content={({ active }) => active ? (
              <div className="rounded border border-gray-200 bg-white px-3 py-2 text-xs shadow">
                <div>Used: {exact(used)}</div>
                <div>Limit: {exact(limit)}</div>
              </div>
            ) : null}
          />
          <Bar dataKey="used" stackId="budget" fill={color} isAnimationActive={false} />
          <Bar dataKey="remaining" stackId="budget" fill="#e5e7eb" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Placeholder that mirrors the four-bar layout of {@link ResourceProfile} so
 * the card keeps its final height while the profile is still streaming in.
 */
export function ResourceProfileSkeleton() {
  return (
    <div className="bg-white rounded-lg shadow p-6" aria-busy="true">
      <h2 className="text-xl font-semibold mb-4">Resource Profile</h2>

      <div className="space-y-6">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index}>
            <div className="flex justify-between mb-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-5 w-40" />
            </div>
            <Skeleton className="h-4 w-full rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

const DEFAULT_THRESHOLDS = { cpu: 80, memory: 80 };

function ResourceChart({ profile }: { profile: ResourceProfileResponse }) {
  const [thresholds, setThresholds] = useState<BudgetThresholds>(DEFAULT_THRESHOLDS);

  useEffect(() => {
    const controller = new AbortController();
    getBudgetThresholds(controller.signal)
      .then(setThresholds)
      .catch(() => {});
    return () => controller.abort();
  }, []);

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold mb-4">Resource Profile</h2>
      <div className="space-y-6">
        <ResourceBar label="CPU Instructions" used={profile.cpu_used} limit={profile.cpu_limit}
          threshold={thresholds.cpu} unit="instructions" />
        <ResourceBar label="Memory" used={profile.memory_used} limit={profile.memory_limit}
          threshold={thresholds.memory} unit="bytes" />
        <ResourceBar label="Read Bytes" used={profile.read_bytes} limit={profile.read_limit}
          threshold={90} unit="bytes" />
        <ResourceBar label="Write Bytes" used={profile.write_bytes} limit={profile.write_limit}
          threshold={90} unit="bytes" />
      </div>
    </div>
  );
}

export function ResourceProfile({ profile, loading }: ResourceProfileProps) {
  if (profile) return <ResourceChart profile={profile} />;
  return loading ? <ResourceProfileSkeleton /> : null;
}

export default ResourceProfile;
