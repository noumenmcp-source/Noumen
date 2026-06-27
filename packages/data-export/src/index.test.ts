import type { ConsentState, IngestEvent, Profile } from "@cdp-us/contracts";
import { describe, expect, it } from "vitest";
import {
  assembleAccessReport,
  planDeletion,
  PROFILE_FIELD_CCPA_CATEGORIES,
  profileFieldKeys,
  redactProfile,
  TOMBSTONE_MARKER,
  type DsarReaders,
  type DsarRequest,
} from "./index.js";

const requestedAt = "2026-06-01T00:00:00.000Z";
const subject = { email: "buyer@example.com", userId: "user_123", anonymousId: "anon_123" };
const request: DsarRequest = { tenantId: "tenant_1", subject, requestedAt };

describe("data-export DSAR domain", () => {
  it("assembles a deterministic access report across CCPA categories", async () => {
    const readers = fakeReaders(profile(), events(), consent());

    const first = await assembleAccessReport(readers, request);
    const second = await assembleAccessReport(readers, request);

    expect(first).toEqual(second);
    expect(first.schemaVersion).toBe("2026-06-ccpa-dsar-v1");
    expect(first.categories.identifiers.map((item) => item.field)).toContain("email");
    expect(first.categories.internet_activity.map((item) => item.field)).toContain("gpc");
    expect(first.categories.internet_activity.map((item) => item.field)).toContain("events.1.event");
    expect(first.categories.commercial.map((item) => item.field)).toContain("firmographics");
    expect(first.categories.inferences.map((item) => item.field)).toContain("intent");
  });

  it("plans deletion without putting legal-hold targets in deletableTargets", async () => {
    const legalRequest: DsarRequest = {
      ...request,
      legalHolds: [{ target: "event", key: "track:Purchase Completed:2026-05-31T10:00:00.000Z", reason: "Transaction retention" }],
    };

    const plan = await planDeletion(fakeReaders(profile(), events(), consent()), legalRequest);
    const held = plan.targets.find((target) => target.key === "track:Purchase Completed:2026-05-31T10:00:00.000Z");

    expect(held).toMatchObject({ action: "retain", legalHold: true, reason: "Transaction retention" });
    expect(plan.deletableTargets).not.toContainEqual(held);
    expect(plan.deletableTargets.every((target) => !target.legalHold)).toBe(true);
  });

  it("redacts PII identifiers while retaining aggregates and firmographics", () => {
    const redacted = redactProfile(profile());

    expect(redacted.id).toBe(TOMBSTONE_MARKER);
    expect(redacted.email).toBe(TOMBSTONE_MARKER);
    expect(redacted.userId).toBe(TOMBSTONE_MARKER);
    expect(redacted.anonymousId).toBe(TOMBSTONE_MARKER);
    expect(redacted.traits.email).toBe(TOMBSTONE_MARKER);
    expect(redacted.traits.pageViews).toBe(12);
    expect(redacted.firmographics.company).toBe("Acme Inc");
    expect(redacted.intent.score).toBe(82);
  });

  it("classifies every Profile field", () => {
    expect(profileFieldKeys()).toEqual(Object.keys(profile()).sort());
    expect(Object.keys(PROFILE_FIELD_CCPA_CATEGORIES).sort()).toEqual(Object.keys(profile()).sort());
  });
});

function fakeReaders(profileValue: Profile, eventValues: readonly IngestEvent[], consentValue: ConsentState): DsarReaders {
  return {
    profiles: { getBySubject: () => profileValue },
    events: { listBySubject: () => eventValues },
    consent: { getState: () => consentValue },
  };
}

function profile(): Profile {
  return {
    id: "profile_1",
    tenantId: "tenant_1",
    anonymousId: "anon_123",
    userId: "user_123",
    email: "buyer@example.com",
    firmographics: { company: "Acme Inc", domain: "acme.com", industry: "Manufacturing", revenueRange: "$10M-$50M" },
    intent: { score: 82, topics: ["pricing"], lastActiveAt: "2026-05-31T10:00:00.000Z" },
    traits: { email: "buyer@example.com", firstName: "Ada", pageViews: 12, plan: "growth" },
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-31T10:00:00.000Z",
  };
}

function events(): readonly IngestEvent[] {
  return [
    {
      type: "identify",
      anonymousId: "anon_123",
      userId: "user_123",
      traits: { email: "buyer@example.com" },
      ts: "2026-05-30T10:00:00.000Z",
    },
    {
      type: "track",
      anonymousId: "anon_123",
      event: "Purchase Completed",
      properties: { orderId: "ord_1", total: 199 },
      ts: "2026-05-31T10:00:00.000Z",
    },
  ];
}

function consent(): ConsentState {
  return { analytics: true, marketing_email: false, sale_or_share: false, messaging_tcpa: false, gpc: true };
}
