import Skeleton from "@/components/shared/Skeleton";
import type { DiagnosticEventEntry } from "@/lib/types";
import { SeverityBadge, getSeverityMeta } from "@/components/shared/SeverityBadge";

interface DiagnosticEventsProps {
  events?: DiagnosticEventEntry[];
  loading?: boolean;
}

const EVENT_ROWS = 3;

function eventTypeStyles(eventType: string): string {
  const norm = eventType.toLowerCase();
  switch (norm) {
    case "error":
    case "panic":
      return "bg-red-100 text-red-800 border-red-300";
    case "fatal":
      return "bg-red-950 text-red-200 border-red-900";
    case "contract":
      return "bg-blue-100 text-blue-800 border-blue-200";
    case "system":
      return "bg-amber-100 text-amber-800 border-amber-300";
    case "debug":
    default:
      return "bg-gray-100 text-gray-800 border-gray-200";
  }
}

/**
 * Placeholder that mirrors the height of a short list of event rows so the card
 * does not grow when the diagnostic events arrive.
 */
export function DiagnosticEventsSkeleton() {
  return (
    <div className="bg-white rounded-lg shadow p-6" aria-busy="true">
      <h2 className="text-xl font-semibold mb-4">Diagnostic Events</h2>
      <div className="space-y-2">
        {Array.from({ length: EVENT_ROWS }, (_, index) => (
          <div key={index} className="p-3 border border-gray-200 rounded">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Skeleton className="h-4 w-8" />
                <Skeleton className="h-4 w-20" />
              </div>
              <Skeleton className="h-4 w-40" />
            </div>
            <Skeleton className="mt-2 h-3 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DiagnosticEvents({
  events = [],
  loading,
}: DiagnosticEventsProps) {
  if (loading && events.length === 0) {
    return <DiagnosticEventsSkeleton />;
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold mb-4">Diagnostic Events</h2>

      {events.length > 0 ? (
        <div className="space-y-2">
          {events.map((event) => (
            <div
              key={event.timeline_position}
              className="p-3 border border-gray-200 rounded"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <span className="text-xs font-mono text-gray-500">
                    #{event.timeline_position}
                  </span>
                  <span
                    className={`px-2 py-1 text-xs font-medium rounded ${eventTypeStyles(
                      event.event_type,
                    )}`}
                  >
                    {event.event_type}
                  </span>
                </div>
                <span className="text-xs text-gray-500">
                  {event.topics.length > 0
                    ? event.topics.join(" → ")
                    : "no topics"}
                </span>
              </div>
              {Object.entries(event.data).length > 0 && (
                <dl className="mt-2 space-y-1 text-xs text-gray-600">
                  {Object.entries(event.data).map(([key, value]) => (
                    <div key={key} className="flex gap-2">
                      <dt className="font-mono text-gray-500">{key}:</dt>
                      <dd className="font-mono break-all">{value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-gray-500 text-center py-8">
          No diagnostic events recorded.
        </p>
      )}
    </div>
  );
}
