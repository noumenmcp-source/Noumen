import type { Profile } from "@cdp-us/contracts";

/** @example const marker = TOMBSTONE_MARKER; */
export const TOMBSTONE_MARKER = "redacted:ccpa-cpra";

const PII_TRAIT_KEYS = new Set(["anonymousId", "email", "firstName", "lastName", "name", "phone", "userId"]);

/** @example const redacted = redactProfile(profile); */
export function redactProfile(profile: Profile): Profile {
  return {
    ...profile,
    id: TOMBSTONE_MARKER,
    anonymousId: TOMBSTONE_MARKER,
    userId: TOMBSTONE_MARKER,
    email: TOMBSTONE_MARKER,
    traits: redactTraits(profile.traits),
  };
}

/** @example const ok = isPiiTraitKey("email"); */
export function isPiiTraitKey(key: string): boolean {
  return PII_TRAIT_KEYS.has(key);
}

function redactTraits(traits: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(traits).map(([key, value]) => [key, isPiiTraitKey(key) ? TOMBSTONE_MARKER : value]),
  );
}
