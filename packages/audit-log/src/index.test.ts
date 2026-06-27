import { describe, expect, it } from "vitest";
import { InMemoryAuditStore, makeEntry, redactMetadata } from "./index.js";

describe("audit log", () => {
  it("appends immutable entries and queries tenant-scoped results", async () => {
    const store = new InMemoryAuditStore();
    const entry = makeEntry(base("tenant_1", "read"), "2026-06-01T00:00:00.000Z");
    await store.append(entry);
    await store.append(makeEntry(base("tenant_2", "read"), "2026-06-01T00:00:01.000Z"));

    expect(await store.query({ tenantId: "tenant_1" })).toEqual([entry]);
    expect(Object.isFrozen((await store.query({ tenantId: "tenant_1" }))[0])).toBe(true);
  });

  it("filters and orders deterministically", async () => {
    const store = new InMemoryAuditStore();
    await store.append(makeEntry(base("tenant_1", "update"), "2026-06-02T00:00:00.000Z"));
    await store.append(makeEntry(base("tenant_1", "read"), "2026-06-01T00:00:00.000Z"));

    expect((await store.query({ tenantId: "tenant_1", actorId: "user_1" })).map((entry) => entry.action)).toEqual(["read", "update"]);
  });

  it("redacts selected metadata keys", () => {
    const entry = makeEntry({ ...base("tenant_1", "export"), metadata: { email: "buyer@example.com", count: 2 } }, "2026-06-01T00:00:00.000Z");
    expect(redactMetadata(entry, ["email"]).metadata).toEqual({ email: "[redacted]", count: 2 });
  });
});

function base(tenantId: string, action: string) {
  return { tenantId, actor: { id: "user_1", role: "admin" as const }, action, resource: { type: "profile", id: "profile_1" } };
}
