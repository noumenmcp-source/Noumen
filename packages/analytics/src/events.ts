import type { AnalyticsEvent } from "./types.js";

export function eventName(event: AnalyticsEvent): string | null {
  if (event.type === "track") return event.event;
  return event.name ?? null;
}

export function eventTs(event: AnalyticsEvent): string | null {
  return typeof event.ts === "string" ? event.ts : null;
}

export function userId(event: AnalyticsEvent): string {
  return event.anonymousId;
}

export function sortedEvents(events: readonly AnalyticsEvent[]): readonly AnalyticsEvent[] {
  return [...events].sort((left, right) => (eventTs(left) ?? "").localeCompare(eventTs(right) ?? ""));
}

export function groupByUser(events: readonly AnalyticsEvent[]): Map<string, readonly AnalyticsEvent[]> {
  const groups = new Map<string, AnalyticsEvent[]>();
  for (const event of sortedEvents(events)) {
    groups.set(userId(event), [...(groups.get(userId(event)) ?? []), event]);
  }
  return groups;
}
