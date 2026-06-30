import { describe, expect, it, vi } from "vitest";
import { events, type Db } from "@cdp-us/db";
import { DbIngestStore, InMemoryIngestStore, type StoredIngestEvent } from "./ingest-store.js";

function ev(name: string | undefined, i: number): StoredIngestEvent {
  return {
    id: `e${i}`,
    tenantId: "t1",
    anonymousId: "a1",
    type: name ? "track" : "identify",
    name,
    properties: {},
    ts: `2026-06-0${i}T00:00:00.000Z`,
    receivedAt: `2026-06-0${i}T00:00:00.000Z`,
  };
}

describe("DbIngestStore", () => {
  it("persists normalized ingest events into the events table", async () => {
    const values = vi.fn(() => Promise.resolve());
    const insert = vi.fn(() => ({ values }));
    // withTenant runs save inside a transaction that first sets the tenant GUC.
    const execute = vi.fn(async () => undefined);
    const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({ insert, execute }));
    const store = new DbIngestStore({ transaction } as unknown as Db);

    await store.save({
      id: "evt_1",
      tenantId: "t_1",
      anonymousId: "anon_1",
      type: "track",
      name: "Pricing Viewed",
      properties: { path: "/pricing" },
      ts: "2026-06-01T00:00:00.000Z",
      receivedAt: "2026-06-01T00:00:01.000Z",
    });

    expect(insert).toHaveBeenCalledWith(events);
    expect(values).toHaveBeenCalledWith({
      id: "evt_1",
      tenantId: "t_1",
      anonymousId: "anon_1",
      type: "track",
      name: "Pricing Viewed",
      properties: { path: "/pricing" },
      ts: new Date("2026-06-01T00:00:00.000Z"),
    });
  });
});

describe("InMemoryIngestStore.deleteByAnonymousId (fine-grained legal hold)", () => {
  async function seeded(): Promise<InMemoryIngestStore> {
    const store = new InMemoryIngestStore();
    await store.save(ev("Page Viewed", 1));
    await store.save(ev("Order Completed", 2));
    await store.save(ev(undefined, 3)); // identify (name null → "identify")
    return store;
  }

  it("deletes every event when no names are retained", async () => {
    const store = await seeded();
    expect(await store.deleteByAnonymousId("t1", "a1")).toBe(3);
    expect(await store.listByTenant("t1")).toHaveLength(0);
  });

  it("retains held event names and deletes the rest", async () => {
    const store = await seeded();
    const removed = await store.deleteByAnonymousId("t1", "a1", ["Order Completed"]);
    expect(removed).toBe(2); // Page Viewed + identify gone
    const left = await store.listByTenant("t1");
    expect(left.map((e) => e.name)).toEqual(["Order Completed"]);
  });

  it('retains identify events when "identify" is held', async () => {
    const store = await seeded();
    const removed = await store.deleteByAnonymousId("t1", "a1", ["identify"]);
    expect(removed).toBe(2);
    expect((await store.listByTenant("t1")).map((e) => e.type)).toEqual(["identify"]);
  });
});
