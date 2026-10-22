import Skeleton from "@/components/shared/Skeleton";

interface ExecutionTimelineProps {
  nodes: any[];
  resourceProfile?: {
    read_bytes: number;
    read_limit: number;
    write_bytes: number;
    write_limit: number;
  };
  loading?: boolean;
}

const TIMELINE_ROWS = 3;

/**
 * Placeholder mirroring the height of a short timeline so the card does not
 * resize when the first trace nodes arrive.
 */
export function ExecutionTimelineSkeleton() {
  return (
    <div className="bg-white rounded-lg shadow p-6" aria-busy="true">
      <h2 className="text-xl font-semibold mb-4">Execution Timeline</h2>
      <div className="space-y-2">
        {Array.from({ length: TIMELINE_ROWS }, (_, index) => (
          <div key={index} className="p-3 border border-gray-200 rounded">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Skeleton className="h-4 w-8" />
                <Skeleton className="h-4 w-24" />
              </div>
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ExecutionTimeline({
  nodes,
  resourceProfile,
  loading,
}: ExecutionTimelineProps) {
  if (loading && nodes.length === 0) {
    return <ExecutionTimelineSkeleton />;
  }

  const isApproachingReadLimit =
    resourceProfile &&
    resourceProfile.read_limit > 0 &&
    resourceProfile.read_bytes / resourceProfile.read_limit > 0.9;
  const isApproachingWriteLimit =
    resourceProfile &&
    resourceProfile.write_limit > 0 &&
    resourceProfile.write_bytes / resourceProfile.write_limit > 0.9;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Execution Timeline</h2>
        {(isApproachingReadLimit || isApproachingWriteLimit) && (
          <span className="px-3 py-1 bg-red-100 text-red-800 text-xs font-medium rounded-full flex items-center">
            <span className="mr-1">⚠️</span>
            Storage IO Warning (Approaching limit)
          </span>
        )}
      </div>
      <div className="space-y-2">
        {nodes.map((node, idx) => (
          <div
            key={idx}
            className="p-3 border border-gray-200 rounded hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <span className="text-xs font-mono text-gray-500">#{idx}</span>
                <span className="font-mono text-sm">
                  {node.node?.event_type || "Unknown"}
                </span>
              </div>
              <span className="text-xs text-gray-500">
                Path: {node.path?.join(" → ") || "root"}
              </span>
            </div>
            {node.node?.data && (
              <pre className="mt-2 text-xs text-gray-600 overflow-x-auto">
                {JSON.stringify(node.node.data, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
      {nodes.length === 0 && (
        <p className="text-gray-500 text-center py-8">
          No trace nodes yet. Waiting for trace data...
        </p>
      )}
    </div>
  );
}

export default ExecutionTimeline;
