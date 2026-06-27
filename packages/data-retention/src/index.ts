/** @example const policy: RetentionPolicy = { category: "events", ttlDays: 365, action: "purge" }; */
export type RetentionPolicy = Readonly<{ category: string; ttlDays: number; action: "purge" | "anonymize" }>;

/** @example const record: RetainableRecord = { id: "evt_1", category: "events", createdAt: "2026-01-01T00:00:00.000Z" }; */
export type RetainableRecord = Readonly<{ id: string; category: string; createdAt: string; legalHold?: boolean }>;

/** @example const plan: RetentionPlan = evaluateRetention(records, policies, now); */
export type RetentionPlan = Readonly<{ purge: readonly string[]; anonymize: readonly string[]; retained: readonly string[]; heldBack: readonly string[] }>;

/** @example const plan = evaluateRetention(records, policies, "2026-06-01T00:00:00.000Z"); */
export function evaluateRetention(records: readonly RetainableRecord[], policies: readonly RetentionPolicy[], now: string): RetentionPlan {
  const plan = { purge: [] as string[], anonymize: [] as string[], retained: [] as string[], heldBack: [] as string[] };
  for (const record of [...records].sort((a, b) => a.id.localeCompare(b.id))) {
    const policy = policies.find((item) => item.category === record.category);
    if (record.legalHold) plan.heldBack.push(record.id);
    else if (!policy || !expired(record, policy, now)) plan.retained.push(record.id);
    else plan[policy.action].push(record.id);
  }
  return plan;
}

/** @example const ts = nextExpiry(record, policies); */
export function nextExpiry(record: RetainableRecord, policies: readonly RetentionPolicy[]): string | null {
  const policy = policies.find((item) => item.category === record.category);
  return policy ? new Date(Date.parse(record.createdAt) + policy.ttlDays * 86_400_000).toISOString() : null;
}

function expired(record: RetainableRecord, policy: RetentionPolicy, now: string): boolean {
  const expiry = Date.parse(record.createdAt) + policy.ttlDays * 86_400_000;
  return expiry < Date.parse(now);
}
