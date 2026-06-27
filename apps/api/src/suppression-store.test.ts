import { describe, expect, it, vi } from "vitest";
import { suppressionEntries, type Db } from "@cdp-us/db";
import { DbSuppressionStore } from "./suppression-store.js";

describe("DbSuppressionStore", () => {
  it("upserts a normalized email with its reason", async () => {
    const onConflictDoUpdate = vi.fn(() => Promise.resolve());
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    const store = new DbSuppressionStore({ insert } as unknown as Db);

    await store.add({ email: "  Buyer@Acme.TEST ", reason: "complaint" });

    expect(insert).toHaveBeenCalledWith(suppressionEntries);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ email: "buyer@acme.test", reason: "complaint" }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: suppressionEntries.email,
        set: expect.objectContaining({ reason: "complaint" }),
      }),
    );
  });

  it("reads a suppression entry by normalized email", async () => {
    const limit = vi.fn(async () => [{ email: "buyer@acme.test", reason: "unsubscribe", updatedAt: new Date() }]);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const store = new DbSuppressionStore({ select } as unknown as Db);

    const entry = await store.get("BUYER@acme.test");

    expect(from).toHaveBeenCalledWith(suppressionEntries);
    expect(entry).toEqual({ email: "buyer@acme.test", reason: "unsubscribe" });
  });

  it("returns null when no entry exists", async () => {
    const limit = vi.fn(async () => []);
    const where = vi.fn(() => ({ limit }));
    const from = vi.fn(() => ({ where }));
    const select = vi.fn(() => ({ from }));
    const store = new DbSuppressionStore({ select } as unknown as Db);

    expect(await store.get("nobody@acme.test")).toBeNull();
  });
});
