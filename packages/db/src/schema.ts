import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
  bigint,
  primaryKey,
} from "drizzle-orm/pg-core";

/** Tenant-scoped schema. US-only. */

export const tenants = pgTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  writeKey: text("write_key").notNull().unique(),
  region: text("region").notNull().default("us"),
  enabledModules: jsonb("enabled_modules").$type<string[]>().notNull().default([]),
  plan: text("plan").notNull().default("agency"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  email: text("email").notNull(),
  role: text("role").notNull().default("viewer"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const profiles = pgTable(
  "profiles",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    anonymousId: text("anonymous_id"),
    userId: text("user_id"),
    email: text("email"),
    firmographics: jsonb("firmographics").$type<Record<string, unknown>>().notNull().default({}),
    intent: jsonb("intent").$type<Record<string, unknown>>().notNull().default({}),
    traits: jsonb("traits").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("profiles_tenant_anon_idx").on(t.tenantId, t.anonymousId)],
);

export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    anonymousId: text("anonymous_id").notNull(),
    type: text("type").notNull(),
    name: text("name"),
    properties: jsonb("properties").$type<Record<string, unknown>>().notNull().default({}),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("events_tenant_ts_idx").on(t.tenantId, t.ts)],
);

export const consentRecords = pgTable(
  "consent_records",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    subject: text("subject").notNull(),
    state: jsonb("state").$type<Record<string, boolean>>().notNull(),
    source: text("source").notNull(),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
    sig: text("sig"),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("consent_tenant_subject_idx").on(t.tenantId, t.subject)],
);

export const apiTokens = pgTable(
  "api_tokens",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull().default("viewer"),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [index("api_tokens_tenant_idx").on(t.tenantId)],
);

export const auditEntries = pgTable(
  "audit_entries",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    actorId: text("actor_id").notNull(),
    actorRole: text("actor_role").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_tenant_ts_idx").on(t.tenantId, t.ts)],
);

/**
 * Email suppression list (CAN-SPAM). Keyed by normalized email — global across
 * the sending surface, matching the @cdp-us/deliverability SuppressionStore
 * contract (no tenant scope). Append/upsert only; never silently dropped.
 */
export const suppressionEntries = pgTable("suppression_entries", {
  email: text("email").primaryKey(),
  reason: text("reason").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Durable current-consent snapshot for the consent gate. One row per
 * (tenant, subject); `state` is the resolved ConsentState purposes. Lets the
 * in-memory gate survive restarts (hydrated on boot). The tamper-evident
 * hash-chained ledger (`consent_records`) is a separate concern.
 */
export const consentStates = pgTable(
  "consent_states",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    subject: text("subject").notNull(),
    state: jsonb("state").$type<Record<string, boolean>>().notNull(),
    source: text("source").notNull().default("banner"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.subject] })],
);

/**
 * Durable metered-usage accumulator backing billing limit enforcement. One row
 * per (tenant, metric); `count` is incremented atomically. Flat accumulator —
 * no period windowing (matches the UsageMeter contract; monthly reset is a
 * separate concern).
 */
export const usageCounters = pgTable(
  "usage_counters",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    metric: text("metric").notNull(),
    // Billing period bucket "YYYY-MM" (UTC). Monthly metrics (emailsPerMonth,
    // eventsPerMonth) reset implicitly when the period rolls over.
    period: text("period").notNull(),
    count: bigint("count", { mode: "number" }).notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.metric, t.period] })],
);
