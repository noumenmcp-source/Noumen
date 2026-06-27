import { describe, it, expect } from "vitest";
import type { IngestEvent } from "@cdp-us/contracts";
import { InMemoryProfileStore } from "./profile-store.js";
import { ProfileService } from "./profile-service.js";

const TENANT = "demo";
let clock = 0;
const now = (): string => new Date(1_000 + clock++).toISOString();

function service(): ProfileService {
  clock = 0;
  return new ProfileService(new InMemoryProfileStore(), now);
}

const identify = (anonymousId: string, userId?: string, traits: Record<string, unknown> = {}): IngestEvent => ({
  type: "identify",
  anonymousId,
  userId,
  traits,
});

const track = (anonymousId: string, event: string): IngestEvent => ({
  type: "track",
  anonymousId,
  event,
  properties: {},
});

describe("ProfileService.applyEvent", () => {
  it("identify creates a profile", async () => {
    const svc = service();
    const profile = await svc.applyEvent(TENANT, identify("a1", undefined, { plan: "pro" }));
    expect(profile.anonymousId).toBe("a1");
    expect(profile.traits.plan).toBe("pro");
    expect(profile.intent.lastActiveAt).toBeDefined();
  });

  it("repeat track on same anonymousId upserts (no dup, same id)", async () => {
    clock = 0;
    const store = new InMemoryProfileStore();
    const svc = new ProfileService(store, now);
    const first = await svc.applyEvent(TENANT, track("a1", "page"));
    const second = await svc.applyEvent(TENANT, track("a1", "page"));
    expect(second.id).toBe(first.id);
    expect(await store.listByTenant(TENANT)).toHaveLength(1);
  });

  it("identify with userId stitches anon->known into one merged profile", async () => {
    const store = new InMemoryProfileStore();
    const svc = new ProfileService(store, now);
    const anon = await svc.applyEvent(TENANT, identify("a1", undefined, { source: "ads" }));
    const known = await svc.applyEvent(TENANT, identify("a1", "u1", { plan: "pro" }));
    expect(known.id).toBe(anon.id);
    expect(known.userId).toBe("u1");
    expect(known.traits.source).toBe("ads");
    expect(known.traits.plan).toBe("pro");
    expect(await store.listByTenant(TENANT)).toHaveLength(1);
  });

  it("lifts firmographics.company from traits.company", async () => {
    const svc = service();
    const profile = await svc.applyEvent(TENANT, identify("a1", "u1", { company: "Acme Inc" }));
    expect(profile.firmographics.company).toBe("Acme Inc");
  });

  it("accumulates intent topics and scores buying intent from events", async () => {
    const store = new InMemoryProfileStore();
    const svc = new ProfileService(store, now);
    await svc.applyEvent(TENANT, track("a1", "Pricing Viewed"));
    const profile = await svc.applyEvent(TENANT, track("a1", "Demo Requested"));
    expect(profile.intent.topics).toEqual(expect.arrayContaining(["pricing", "evaluation"]));
    expect(profile.intent.score).toBeGreaterThan(0);
  });

  it("intent score is idempotent on event replay", async () => {
    const store = new InMemoryProfileStore();
    const svc = new ProfileService(store, now);
    await svc.applyEvent(TENANT, track("a1", "Pricing Viewed"));
    const first = await svc.applyEvent(TENANT, track("a1", "Demo Requested"));
    const replay = await svc.applyEvent(TENANT, track("a1", "Demo Requested"));
    expect(replay.intent.score).toBe(first.intent.score);
    expect(replay.intent.topics).toEqual(first.intent.topics);
  });
});
