import { describe, expect, it, vi } from "vitest";
import { events, type Db } from "@cdp-us/db";
import { DbIngestStore } from "./ingest-store.js";

describe("DbIngestStore", () => {
  it("persists normalized ingest events into the events table", async () => {
    const values = vi.fn(() => Promise.resolve());
    const insert = vi.fn(() => ({ values }));
    const store = new DbIngestStore({ insert } as unknown as Db);

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
