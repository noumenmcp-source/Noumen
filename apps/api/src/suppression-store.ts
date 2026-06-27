import { eq } from "drizzle-orm";
import type { SuppressionEntry, SuppressionStore } from "@cdp-us/deliverability";
import { suppressionEntries, type Db } from "@cdp-us/db";

/**
 * Postgres-backed email suppression list (CAN-SPAM). Faithful to the
 * @cdp-us/deliverability SuppressionStore contract: keyed by normalized email,
 * global (no tenant scope). Upsert semantics — re-adding an email overwrites the
 * reason, matching InMemorySuppressionStore.
 */
export class DbSuppressionStore implements SuppressionStore {
  constructor(private readonly db: Db) {}

  async add(entry: SuppressionEntry): Promise<void> {
    const email = normalizeEmail(entry.email);
    await this.db
      .insert(suppressionEntries)
      .values({ email, reason: entry.reason, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: suppressionEntries.email,
        set: { reason: entry.reason, updatedAt: new Date() },
      });
  }

  async get(email: string): Promise<SuppressionEntry | null> {
    const normalized = normalizeEmail(email);
    const [row] = await this.db
      .select()
      .from(suppressionEntries)
      .where(eq(suppressionEntries.email, normalized))
      .limit(1);
    return row
      ? { email: row.email, reason: row.reason as SuppressionEntry["reason"] }
      : null;
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
