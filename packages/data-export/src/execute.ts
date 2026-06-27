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
  /** Hard-delete all events for a subject; returns the number removed. */
  deleteEvents(tenantId: TenantId, subject: Subject): Promise<number>;
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
 * subject, honoring legal holds. Profiles and events under a legal hold are
 * never touched. Event deletion is all-or-nothing per subject: if *any* event
 * target is held, all events are retained (fine-grained per-event deletion under
 * a partial hold is intentionally not attempted — retaining is the safe choice).
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
  const anyEventHeld = eventTargets.some((target) => target.legalHold);
  let deletedEvents = 0;
  if (eventTargets.length > 0 && !anyEventHeld) {
    deletedEvents = await eraser.deleteEvents(plan.tenantId, plan.subject);
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
