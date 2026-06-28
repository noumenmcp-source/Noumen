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

  it("merges two distinct profiles when identify links an anon to a known user", async () => {
    clock = 0;
    const store = new InMemoryProfileStore();
    const svc = new ProfileService(store, now);
    const p1 = await svc.applyEvent(TENANT, track("a1", "page")); // anonymous-only
    const p2 = await svc.applyEvent(
      TENANT,
      identify("a2", "u1", { plan: "pro" }),
    ); // known identity, different anon
    expect(await store.listByTenant(TENANT)).toHaveLength(2);

    const merged = await svc.applyEvent(
      TENANT,
      identify("a1", "u1", { source: "ads" }),
    );
    expect(merged.id).toBe(p2.id); // canonical = the known-identity profile
    expect(merged.userId).toBe("u1");
    expect(merged.anonymousId).toBe("a1"); // now owns the event's anon id
    expect(merged.traits.plan).toBe("pro"); // carried from the known profile
    expect(merged.traits.source).toBe("ads"); // from the linking event
    expect(await store.listByTenant(TENANT)).toHaveLength(1); // duplicate folded in
    expect(await store.getById(TENANT, p1.id)).toBeUndefined(); // and removed
  });

  it("raises a saturating intent score as activity accumulates", async () => {
    clock = 0;
    const store = new InMemoryProfileStore();
    const svc = new ProfileService(store, now);
    const t1 = await svc.applyEvent(TENANT, track("a1", "page")); // +5
    expect(t1.intent.score).toBe(5);
    const t2 = await svc.applyEvent(TENANT, track("a1", "page")); // +5 => 10
    expect(t2.intent.score).toBe(10);
    const id = await svc.applyEvent(TENANT, identify("a1", "u1")); // +10 => 20
    expect(id.intent.score).toBe(20);
  });
});
