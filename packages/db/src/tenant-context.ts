import { sql } from "drizzle-orm";
import type { Db } from "./index.js";

/**
 * Run `fn` inside a transaction with the request's tenant bound to the
 * `app.tenant_id` GUC, so Postgres row-level-security policies can scope every
 * statement to that tenant. `set_config(..., true)` is transaction-local (resets
 * on commit/rollback). Until RLS is enabled on a table this is a harmless no-op,
 * so stores can adopt it ahead of the policy migration without behavior change.
 *
 * The tenant id is passed as a bound parameter (no SQL injection surface).
 *
 * @example const rows = await withTenant(db, "t_1", (tx) => tx.select().from(events));
 */
export async function withTenant<T>(db: Db, tenantId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx as unknown as Db);
  });
}
