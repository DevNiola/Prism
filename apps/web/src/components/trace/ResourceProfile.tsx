import Skeleton from "@/components/shared/Skeleton";

interface ResourceProfileData {
  cpu_used: number;
  memory_used: number;
  cpu_limit: number;
  memory_limit: number;
  read_bytes: number;
  read_limit: number;
  write_bytes: number;
  write_limit: number;
}

interface ResourceProfileProps {
  profile?: ResourceProfileData;
  loading?: boolean;
}

function ResourceBar({
  label,
  used,
  limit,
  format,
}: {
  label: string;
  used: number;
  limit: number;
  format?: (v: number) => string;
}) {
  const percentage = limit > 0 ? (used / limit) * 100 : 0;
  const displayValue = format ? format(used) : used.toLocaleString();
  const displayLimit = format ? format(limit) : limit.toLocaleString();
  const isBudgetExceeded = limit > 0 && used > limit;

  // Color code: green (<50%), amber (50-80%), red (>80%)
  const barColor =
    percentage > 80
      ? "bg-red-500"
      : percentage >= 50
        ? "bg-amber-500"
        : "bg-emerald-500";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-sm font-semibold text-gray-800">{label}</span>
          {isBudgetExceeded && (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700 border border-red-300 animate-pulse"
              role="alert"
            >
              ⚠ Budget Exceeded
            </span>
          )}
        </div>
        <div className="text-right">
          <span className="text-xs font-mono text-gray-500">
            {displayValue} / {displayLimit}
          </span>
          <span
            className={`ml-2 text-xs font-bold ${
              percentage > 80
                ? "text-red-600"
                : percentage >= 50
                  ? "text-amber-600"
                  : "text-emerald-600"
            }`}
          >
            {percentage.toFixed(1)}%
          </span>
        </div>
      </div>

      <div className="relative w-full bg-gray-100 border border-gray-200 rounded-full h-3.5 overflow-hidden">
        {/* Visual threshold guides at 50% and 80% */}
        <div
          className="absolute top-0 bottom-0 left-1/2 w-px bg-gray-300 z-10 opacity-70"
          title="50% Threshold"
        />
        <div
          className="absolute top-0 bottom-0 left-[80%] w-px bg-gray-400 z-10 opacity-70"
          title="80% Warning Threshold"
        />

        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${barColor}`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB"];
  const i = Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1);
  return `${(bytes / (1 << (i * 10))).toFixed(i > 0 ? 2 : 0)} ${units[i]}`;
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

export function ResourceProfile({ profile, loading }: ResourceProfileProps) {
  if (loading && !profile) {
    return <ResourceProfileSkeleton />;
  }

  if (!profile) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold mb-4">Resource Profile</h2>

      <div className="space-y-6">
        <ResourceBar
          label="CPU Instructions"
          used={profile.cpu_used}
          limit={profile.cpu_limit}
        />
        <ResourceBar
          label="Memory"
          used={profile.memory_used}
          limit={profile.memory_limit}
          format={(v) => formatBytes(v)}
        />
        <ResourceBar
          label="Read Bytes"
          used={profile.read_bytes}
          limit={profile.read_limit}
          format={(v) => formatBytes(v)}
        />
        <ResourceBar
          label="Write Bytes"
          used={profile.write_bytes}
          limit={profile.write_limit}
          format={(v) => formatBytes(v)}
        />
      </div>

      {profile.cpu_limit > 0 && profile.cpu_used / profile.cpu_limit > 0.9 && (
        <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
          <p className="text-sm text-yellow-800">
            Resource usage is approaching limits. Consider optimizing contract
            code.
          </p>
        </div>
      )}
    </div>
  );
}

export default ResourceProfile;
