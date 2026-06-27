import type { IngestEvent, Profile, TenantId } from "@cdp-us/contracts";
import type { ProfileStore } from "./profile-store.js";

/**
 * Resolve the profile an event belongs to: prefer the known `userId`, falling
 * back to the `anonymousId`. Returns `undefined` when neither matches.
 *
 * @example
 * const existing = await resolveExisting(store, "demo", {
 *   type: "track", anonymousId: "a1", event: "view", properties: {},
 * });
 */
export async function resolveExisting(
  store: ProfileStore,
  tenantId: TenantId,
  event: IngestEvent,
): Promise<Profile | undefined> {
  const userId = event.type === "identify" ? event.userId : undefined;
  if (userId) {
    const byUser = await store.getByUserId(tenantId, userId);
    if (byUser) return byUser;
  }
  return store.getByAnonymousId(tenantId, event.anonymousId);
}

/**
 * Build a fresh Profile from an event. Pure helper: it does not persist.
 *
 * @example
 * const p = newProfile("demo", { type: "identify", anonymousId: "a1", traits: {} }, () => new Date(0).toISOString());
 */
export function newProfile(
  tenantId: TenantId,
  event: IngestEvent,
  now: () => string,
): Profile {
  const ts = now();
  return {
    id: makeProfileId(),
    tenantId,
    anonymousId: event.anonymousId,
    userId: event.type === "identify" ? event.userId : undefined,
    firmographics: {},
    intent: { lastActiveAt: ts },
    traits: {},
    createdAt: ts,
    updatedAt: ts,
  };
}

function makeProfileId(): string {
  return `p_${crypto.randomUUID()}`;
}
