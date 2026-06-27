import { describe, expect, it, vi } from "vitest";
import { auditEntries, type Db } from "@cdp-us/db";
import type { AuditEntry } from "@cdp-us/audit-log";
import { DbAuditStore } from "./audit-store.js";

const ENTRY: AuditEntry = {
  tenantId: "t_1",
  actor: { id: "u_1", role: "owner" },
  action: "read",
  resource: { type: "profile", id: "p_1" },
  ts: "2026-06-01T00:00:00.000Z",
  metadata: { ip: "203.0.113.7" },
};

describe("DbAuditStore", () => {
  it("appends an entry into audit_entries with a generated id", async () => {
    const values = vi.fn(() => Promise.resolve());
    const insert = vi.fn(() => ({ values }));
    const store = new DbAuditStore({ insert } as unknown as Db);

    await store.append(ENTRY);

    expect(insert).toHaveBeenCalledWith(auditEntries);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        tenantId: "t_1",
        actorId: "u_1",
        actorRole: "owner",
        action: "read",
        resourceType: "profile",
        resourceId: "p_1",
        metadata: { ip: "203.0.113.7" },
        ts: new Date("2026-06-01T00:00:00.000Z"),
      }),
    );
  });

  it("maps persisted rows back to AuditEntry on query", async () => {
    const row = {
      id: "a_1",
      tenantId: "t_1",
      actorId: "u_1",
      actorRole: "owner",
      action: "read",
      resourceType: "profile",
      resourceId: "p_1",
      metadata: { ip: "203.0.113.7" },
      ts: new Date("2026-06-01T00:00:00.000Z"),
    };
    const orderBy = vi.fn(async () => [row]);
    const where = vi.fn(() => ({ orderBy }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const store = new DbAuditStore({ select } as unknown as Db);

    const entries = await store.query({ tenantId: "t_1", action: "read" });

    expect(select).toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith(auditEntries);
    expect(entries).toEqual([
      {
        tenantId: "t_1",
        actor: { id: "u_1", role: "owner" },
        action: "read",
        resource: { type: "profile", id: "p_1" },
        ts: "2026-06-01T00:00:00.000Z",
        metadata: { ip: "203.0.113.7" },
      },
    ]);
  });
});
