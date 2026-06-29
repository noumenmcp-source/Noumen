import type { TenantId } from "@cdp-us/contracts";
import type { DeletionPlan, DeletionTarget, Subject } from "./types.js";

/**
 * Side-effecting eraser the host wires over its real stores. `executeDeletion`
 * orchestrates it from a {@link DeletionPlan}; the eraser only performs the
 * primitive mutations.
 *
 * @example const eraser: DsarEraser = createDsarEraser(profileStore, ingestStore);
 */
export interface DsarEraser {
  /** Redact direct identifiers on a profile in place (CCPA de-identification). */
  anonymizeProfile(tenantId: TenantId, profileId: string): Promise<void>;
  /**
   * Hard-delete a subject's events; returns the number removed. When
   * `retainEventNames` is given, events whose name is in that set are kept
   * (fine-grained legal hold); omit it to delete every event.
   */
  deleteEvents(tenantId: TenantId, subject: Subject, retainEventNames?: readonly string[]): Promise<number>;
}

/** @example const result = await executeDeletion(eraser, plan); */
export type DeletionResult = Readonly<{
  tenantId: TenantId;
  subject: Subject;
  requestedAt: string;
  anonymizedProfiles: number;
  deletedEvents: number;
  retained: readonly DeletionTarget[];
}>;

/**
 * Execute a deletion plan: anonymize profiles and hard-delete events for the
 * subject, honoring legal holds. Profiles under a legal hold are never touched.
 * Event deletion is fine-grained: events whose name is under a legal hold are
 * retained, every other event is deleted. A hold with no key retains all events
 * of that subject (it matches every event name).
 *
 * @example const result = await executeDeletion(eraser, await planDeletion(readers, request));
 */
export async function executeDeletion(
  eraser: DsarEraser,
  plan: DeletionPlan,
): Promise<DeletionResult> {
  // Delete events BEFORE anonymizing profiles: the eraser resolves a subject's
  // events via its (still-intact) profile, which anonymization would scrub.
  const eventTargets = plan.targets.filter((target) => target.type === "event");
  const heldNames = [
    ...new Set(eventTargets.filter((t) => t.legalHold && t.name).map((t) => t.name as string)),
  ];
  const hasDeletableEvent = eventTargets.some((t) => !t.legalHold);
  let deletedEvents = 0;
  if (hasDeletableEvent) {
    // Pass the retained names so the eraser keeps held events and deletes the rest.
    deletedEvents = await eraser.deleteEvents(
      plan.tenantId,
      plan.subject,
      heldNames.length > 0 ? heldNames : undefined,
    );
  }

  let anonymizedProfiles = 0;
  for (const target of plan.deletableTargets) {
    if (target.type !== "profile") continue;
    await eraser.anonymizeProfile(plan.tenantId, target.key);
    anonymizedProfiles += 1;
  }

  return {
    tenantId: plan.tenantId,
    subject: plan.subject,
    requestedAt: plan.requestedAt,
    anonymizedProfiles,
    deletedEvents,
    retained: plan.targets.filter((target) => target.action === "retain"),
  };
}
