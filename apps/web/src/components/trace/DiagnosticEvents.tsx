"use client";

import { useState } from "react";
import Skeleton from "@/components/shared/Skeleton";
import type { DiagnosticEventEntry } from "@/lib/types";

interface DiagnosticEventsProps {
  events?: DiagnosticEventEntry[];
  loading?: boolean;
  timelineId?: string;
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
  timelineId,
}: DiagnosticEventsProps) {
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const eventTypes = [...new Set(events.map((event) => event.event_type))];
  const activeType = selectedType !== null && eventTypes.includes(selectedType)
    ? selectedType
    : null;
  const query = search.trim().toLowerCase();
  const visibleEvents = events
    .filter((event) =>
      (activeType === null || event.event_type === activeType) &&
      (!query ||
        event.topics.some((topic) => topic.toLowerCase().includes(query)) ||
        JSON.stringify(event.data).toLowerCase().includes(query)),
    )
    .sort((a, b) => a.timeline_position - b.timeline_position);

  if (loading && events.length === 0) {
    return <DiagnosticEventsSkeleton />;
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold mb-4">Diagnostic Events</h2>

      {events.length > 0 && (
        <div className="mb-4 space-y-3">
          <div role="group" aria-label="Event type" className="flex flex-wrap gap-2">
            {[null, ...eventTypes].map((type) => (
              <button
                key={type === null ? "all" : `type-${type}`}
                type="button"
                aria-pressed={activeType === type}
                onClick={() => setSelectedType(type)}
                className={`rounded-full border px-3 py-1 text-xs ${
                  activeType === type ? "bg-violet-700 text-white" : "bg-white text-slate-700"
                }`}
              >
                {type === null ? "All events" : `${type} events`}
              </button>
            ))}
          </div>
          <input
            type="search"
            aria-label="Search diagnostic events"
            placeholder="Search topics and data"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      )}

      {visibleEvents.length > 0 ? (
        <div className="space-y-2">
          {visibleEvents.map((event, index) => (
            <div
              key={`${event.timeline_position}-${index}`}
              className="p-3 border border-gray-200 rounded"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <span className="text-xs font-mono text-gray-500">
                    {timelineId ? (
                      <a
                        className="text-violet-700 underline"
                        href={`#${timelineId}-step-${event.timeline_position}`}
                        aria-label={`Jump to timeline step ${event.timeline_position}`}
                      >
                        #{event.timeline_position}
                      </a>
                    ) : (
                      `#${event.timeline_position}`
                    )}
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
          {events.length ? "No diagnostic events match your filters." : "No diagnostic events recorded."}
        </p>
      )}
    </div>
  );
}
