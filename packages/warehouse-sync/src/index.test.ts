import type { IngestEvent, Profile } from "@cdp-us/contracts";
import { describe, expect, it, vi } from "vitest";
import { batch, buildEventRows, buildProfileRows, dialectType, sync, type Dialect } from "./index.js";

describe("warehouse sync", () => {
  it("maps logical types for all dialects", () => {
    const dialects: readonly Dialect[] = ["bigquery", "snowflake", "redshift"];
    expect(dialects.map((dialect) => dialectType(dialect, "json"))).toEqual(["JSON", "VARIANT", "SUPER"]);
  });

  it("builds deterministic profile rows and excludes sensitive fields by default", () => {
    const output = buildProfileRows([profile("p2"), profile("p1")], { dialect: "bigquery" });

    expect(output.rows.map((row) => row.profile_id)).toEqual(["p1", "p2"]);
    expect(output.columns.map((column) => column.name)).not.toContain("revenue_range");
    expect(JSON.stringify(output)).not.toContain("$10M-$50M");
    expect(buildProfileRows([profile("p1")], { dialect: "bigquery", includeSensitive: true }).columns.map((c) => c.name))
      .toContain("revenue_range");
  });

  it("builds event rows and slices batches", () => {
    const output = buildEventRows(events(), { dialect: "redshift" });

    expect(output.rows[0]).toMatchObject({ type: "track", event: "Signed Up" });
    expect(batch([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("syncs through an injected retrying loader", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("transient")).mockResolvedValueOnce({ ok: true, rows: 1 });
    const results = await sync([buildEventRows(events(), { dialect: "snowflake" })], { load });

    expect(load).toHaveBeenCalledTimes(2);
    expect(results).toEqual([{ ok: true, rows: 1, attempts: 2 }]);
  });
});

function profile(id: string): Profile {
  return {
    id,
    tenantId: "tenant_1",
    anonymousId: `anon_${id}`,
    userId: `user_${id}`,
    email: `${id}@example.com`,
    firmographics: { company: "Acme", domain: "acme.com", revenueRange: "$10M-$50M" },
    intent: { score: 80 },
    traits: { plan: "growth" },
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
  };
}

function events(): readonly IngestEvent[] {
  return [{ type: "track", anonymousId: "anon_1", event: "Signed Up", properties: {}, ts: "2026-06-01T00:00:00.000Z" }];
}
