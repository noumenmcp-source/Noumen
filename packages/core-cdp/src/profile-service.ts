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
    // Identity-resolution. When an `identify` links an anonymousId that already
    // has its own profile to a userId that has a *different* profile, the two
    // are merged into one canonical profile (the known-identity one wins), and
    // the anonymous duplicate is folded in and removed.
    const { base, mergeFrom } = await this.#resolve(tenantId, event);
    const ts = this.#now();

    const baseTraits = mergeFrom
      ? mergeTraits(mergeFrom.traits, base.traits)
      : base.traits;
    const traits = mergeTraits(baseTraits, eventTraits(event));

    const baseFirmographics = mergeFrom
      ? { ...mergeFrom.firmographics, ...base.firmographics }
      : base.firmographics;

    const next: Profile = {
      ...base,
      anonymousId: event.anonymousId ?? base.anonymousId ?? mergeFrom?.anonymousId,
      userId:
        event.type === "identify"
          ? event.userId ?? base.userId ?? mergeFrom?.userId
          : base.userId ?? mergeFrom?.userId,
      email: base.email ?? mergeFrom?.email,
      traits,
      firmographics: liftFirmographics(baseFirmographics, traits),
      intent: {
        ...base.intent,
        lastActiveAt: ts,
        score: nextIntentScore(base.intent.score, mergeFrom?.intent.score, event),
      },
      createdAt: earliest(base.createdAt, mergeFrom?.createdAt),
      updatedAt: ts,
    };

    const saved = await this.#store.save(next);
    if (mergeFrom && mergeFrom.id !== base.id) {
      await this.#store.delete(tenantId, mergeFrom.id);
    }
    return saved;
  }

  /**
   * Resolve the canonical profile to update plus an optional duplicate to merge
   * in. Merge happens only on `identify` with a userId, when distinct profiles
   * exist for the userId and the anonymousId.
   */
  async #resolve(
    tenantId: TenantId,
    event: IngestEvent,
  ): Promise<{ base: Profile; mergeFrom?: Profile }> {
    if (event.type === "identify" && event.userId) {
      const [byUser, byAnon] = await Promise.all([
        this.#store.getByUserId(tenantId, event.userId),
        this.#store.getByAnonymousId(tenantId, event.anonymousId),
      ]);
      if (byUser && byAnon && byUser.id !== byAnon.id) {
        return { base: byUser, mergeFrom: byAnon };
      }
      const existing = byUser ?? byAnon;
      if (existing) return { base: existing };
    } else {
      const existing = await resolveExisting(this.#store, tenantId, event);
      if (existing) return { base: existing };
    }
    return { base: newProfile(tenantId, event, this.#now) };
  }
}

/** Earliest of two ISO timestamps (b may be absent). */
function earliest(a: string, b?: string): string {
  if (!b) return a;
  return a <= b ? a : b;
}

/**
 * Saturating behavioral intent score (0..100). Each event nudges it up
 * (identify weighs more than track); merged profiles combine their scores.
 */
function nextIntentScore(
  baseScore: number | undefined,
  mergeScore: number | undefined,
  event: IngestEvent,
): number {
  const start = (baseScore ?? 0) + (mergeScore ?? 0);
  const step = event.type === "identify" ? 10 : 5;
  return Math.min(100, start + step);
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
