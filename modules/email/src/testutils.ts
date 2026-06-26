import type { Profile } from "@cdp-us/contracts";

/**
 * Test-only profile factory. Deterministic defaults; override per case.
 * Kept in src (not a test file) so multiple *.test.ts files can import it.
 */
export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  const base: Profile = {
    id: "p_1",
    tenantId: "t_1",
    anonymousId: "anon_1",
    userId: undefined,
    email: "buyer@acme.test",
    firmographics: {
      company: "Acme Corp",
      domain: "acme.test",
      industry: "Manufacturing",
      employeeRange: "201-500",
      revenueRange: "$10M-$50M",
      country: "US",
    },
    intent: {
      score: 80,
      topics: ["pricing", "integrations"],
      lastActiveAt: "2026-06-01T00:00:00.000Z",
    },
    traits: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  return {
    ...base,
    ...overrides,
    firmographics: { ...base.firmographics, ...overrides.firmographics },
    intent: { ...base.intent, ...overrides.intent },
    traits: { ...base.traits, ...overrides.traits },
  };
}
