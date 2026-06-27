import type { Profile } from "@cdp-us/contracts";
import { describe, expect, it } from "vitest";
import { deriveDomain, enrichProfile, normalizeFirmographics, type EnrichmentProvider } from "./index.js";

describe("enrichment", () => {
  it("derives corporate domains and skips free-mail domains", () => {
    expect(deriveDomain({ ...profile(), email: "buyer@gmail.com" })).toBeNull();
    expect(deriveDomain({ ...profile(), email: "buyer@Acme.COM" })).toBe("acme.com");
    expect(deriveDomain({ ...profile(), firmographics: { domain: "https://www.example.com/path" } })).toBe("example.com");
  });

  it("normalizes firmographics deterministically", () => {
    expect(normalizeFirmographics({ industry: "SaaS", employeeRange: "10 - 50", revenueRange: "$10M-$50M", country: "us" })).toEqual({
      industry: "software",
      employeeRange: "11-50",
      revenueRange: "10m-50m",
      country: "US",
    });
  });

  it("merges providers without mutating input and gates sensitive revenue", async () => {
    const original = profile();
    const snapshot = JSON.stringify(original);
    const provider: EnrichmentProvider = { source: "fixture", lookup: async () => ({ company: "Acme", revenueRange: "$50M+" }) };

    const enriched = await enrichProfile(original, [provider]);
    const sensitive = await enrichProfile(original, [provider], { includeSensitive: true });

    expect(enriched.firmographics).toEqual({ company: "Acme" });
    expect(sensitive.firmographics.revenueRange).toBe("50m+");
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("preserves manually supplied fields when preferExisting is true", async () => {
    const provider: EnrichmentProvider = { source: "fixture", lookup: async () => ({ company: "Provider", industry: "finance" }) };
    const enriched = await enrichProfile({ ...profile(), firmographics: { company: "Manual" } }, [provider], { preferExisting: true });

    expect(enriched.firmographics).toEqual({ company: "Manual", industry: "financial_services" });
  });
});

function profile(): Profile {
  return { id: "p1", tenantId: "t1", email: "buyer@example.com", firmographics: {}, intent: {}, traits: {}, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
}
