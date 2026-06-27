import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

/** Tenant-scoped schema. US-only. */

export const tenants = pgTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  writeKey: text("write_key").notNull().unique(),
  region: text("region").notNull().default("us"),
  enabledModules: jsonb("enabled_modules").$type<string[]>().notNull().default([]),
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
  },
  (t) => [index("api_tokens_tenant_idx").on(t.tenantId)],
);
