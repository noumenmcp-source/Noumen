import type { Firmographics, IngestEvent, Profile, TenantId } from "@cdp-us/contracts";
import { newProfile, resolveExisting } from "./identity.js";
import type { ProfileStore } from "./profile-store.js";

/** Firmographic keys lifted from event traits into Profile.firmographics. */
const FIRMOGRAPHIC_KEYS = [
  "company",
  "domain",
  "industry",
  "employeeRange",
  "revenueRange",
  "country",
] as const;

/**
 * Builds and maintains CDP profiles from ingest events. Merges traits (never
 * overwrites the whole map), stitches anonymous -> known on identify, lifts
 * firmographic traits, and tracks last-active intent. Idempotent per
 * (tenantId, anonymousId).
 *
 * @example
 * const svc = new ProfileService(new InMemoryProfileStore());
 * await svc.applyEvent("demo", { type: "identify", anonymousId: "a1", userId: "u1", traits: { company: "Acme" } });
 */
export class ProfileService {
  readonly #store: ProfileStore;
  readonly #now: () => string;

  constructor(store: ProfileStore, now: () => string = () => new Date().toISOString()) {
    this.#store = store;
    this.#now = now;
  }

  /**
   * Apply one event, returning the resulting persisted profile.
   *
   * @example
   * const profile = await svc.applyEvent("demo", { type: "track", anonymousId: "a1", event: "view", properties: {} });
   */
  async applyEvent(tenantId: TenantId, event: IngestEvent): Promise<Profile> {
    const existing = await resolveExisting(this.#store, tenantId, event);
    const base = existing ?? newProfile(tenantId, event, this.#now);
    const ts = this.#now();
    const traits = mergeTraits(base.traits, eventTraits(event));
    const next: Profile = {
      ...base,
      anonymousId: base.anonymousId ?? event.anonymousId,
      userId: event.type === "identify" ? event.userId ?? base.userId : base.userId,
      traits,
      firmographics: liftFirmographics(base.firmographics, traits),
      intent: { ...base.intent, lastActiveAt: ts },
      updatedAt: ts,
    };
    return this.#store.save(next);
  }
}

/** Traits carried by an event: identify.traits, or {} for track. */
function eventTraits(event: IngestEvent): Record<string, unknown> {
  return event.type === "identify" ? event.traits : {};
}

/** Shallow-merge incoming traits onto existing ones (incoming wins per key). */
function mergeTraits(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  return { ...existing, ...incoming };
}

/** Lift known firmographic keys from traits into firmographics (merge). */
function liftFirmographics(
  existing: Firmographics,
  traits: Record<string, unknown>,
): Firmographics {
  const lifted: Firmographics = { ...existing };
  for (const key of FIRMOGRAPHIC_KEYS) {
    const value = traits[key];
    if (typeof value === "string" && value.length > 0) {
      lifted[key] = value;
    }
  }
  return lifted;
}
