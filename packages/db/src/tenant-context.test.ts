import { describe, expect, it, vi } from "vitest";
import type { Db } from "./index.js";
import { withTenant } from "./tenant-context.js";

describe("withTenant", () => {
  it("sets app.tenant_id (bound) inside a transaction before running fn", async () => {
    const execute = vi.fn(async (_query: unknown) => undefined);
    const tx = { execute };
    // db.transaction(cb) → runs cb with the tx and returns its result.
    const db = { transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)) } as unknown as Db;

    const fn = vi.fn(async (t: Db) => {
      expect(t).toBe(tx); // fn receives the transaction, not the pool
      return "result";
    });

    const out = await withTenant(db, "t_42", fn as unknown as (tx: Db) => Promise<string>);

    expect(out).toBe("result");
    // set_config ran first, before fn.
    const setConfigCall = execute.mock.invocationCallOrder[0];
    const fnCall = fn.mock.invocationCallOrder[0];
    expect(setConfigCall).toBeLessThan(fnCall);

    // The tenant id is a bound parameter, not interpolated into the SQL text.
    const flat = JSON.stringify(execute.mock.calls[0]?.[0]);
    expect(flat).toContain("set_config");
    expect(flat).toContain("t_42"); // present as a param value
  });
});
