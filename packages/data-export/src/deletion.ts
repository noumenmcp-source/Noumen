import type { IngestEvent, Profile } from "@cdp-us/contracts";
import { sortDeletionTargets } from "./sort.js";
import type { DeletionPlan, DeletionTarget, DeletionTargetType, DsarReaders, DsarRequest, LegalHold } from "./types.js";

/** @example const plan = await planDeletion(readers, request); */
export async function planDeletion(readers: DsarReaders, request: DsarRequest): Promise<DeletionPlan> {
  const [profile, events] = await Promise.all([
    readers.profiles.getBySubject(request.tenantId, request.subject),
    readers.events.listBySubject(request.tenantId, request.subject),
  ]);
  const targets = sortDeletionTargets([...profileTargets(profile, request), ...eventTargets(events, request), derivedTarget(request)]);

  return {
    tenantId: request.tenantId,
    subject: request.subject,
    requestedAt: request.requestedAt,
    targets,
    deletableTargets: targets.filter((target) => !target.legalHold),
  };
}

function profileTargets(profile: Profile | null, request: DsarRequest): readonly DeletionTarget[] {
  if (!profile) return [];
  return [target("profile", profile.id, "anonymize", request.legalHolds)];
}

function eventTargets(events: readonly IngestEvent[], request: DsarRequest): readonly DeletionTarget[] {
  // Event legal holds match by event NAME (e.g. retain all "Order Completed" for
  // transaction retention), not by the synthetic per-event key.
  return events.map((event, index) => {
    const name = eventName(event);
    const key = eventKey(event, index);
    const hold = (request.legalHolds ?? []).find((item) => item.target === "event" && (!item.key || item.key === name));
    return hold
      ? { type: "event" as const, key, name, action: "retain" as const, legalHold: true, reason: hold.reason }
      : { type: "event" as const, key, name, action: "delete" as const, legalHold: false };
  });
}

function derivedTarget(request: DsarRequest): DeletionTarget {
  return target("derived", subjectKey(request), "delete", request.legalHolds);
}

function target(
  type: DeletionTargetType,
  key: string,
  action: "delete" | "anonymize",
  legalHolds: readonly LegalHold[] = [],
): DeletionTarget {
  const hold = legalHolds.find((item) => item.target === type && (!item.key || item.key === key));
  return hold ? { type, key, action: "retain", legalHold: true, reason: hold.reason } : { type, key, action, legalHold: false };
}

function eventName(event: IngestEvent): string {
  return event.type === "track" ? event.event : "identify";
}

function eventKey(event: IngestEvent, index: number): string {
  return `${event.type}:${eventName(event)}:${event.ts ?? index}`;
}

function subjectKey(request: DsarRequest): string {
  return request.subject.userId ?? request.subject.email ?? request.subject.anonymousId ?? "unknown-subject";
}
