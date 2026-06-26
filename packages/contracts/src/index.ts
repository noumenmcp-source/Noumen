import { z } from "zod";

/**
 * Shared domain contracts for the CDP-US ecosystem.
 * US-only system. No RF/152-FZ concepts here (see SEGMENTATION.md).
 */

// ---- IDs ----
export type TenantId = string;
export type ProfileId = string;
export type UserId = string;

// ---- RBAC ----
export const ROLES = ["owner", "admin", "analyst", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export interface User {
  id: UserId;
  tenantId: TenantId;
  email: string;
  role: Role;
  createdAt: string;
}

// ---- Modules (the upsell registry) ----
export const MODULE_KEYS = [
  "email",
  "social-intel",
  "youtube",
  "automation",
  "consent",
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

// ---- Consent (CCPA/CPRA/CAN-SPAM/TCPA) ----
export const CONSENT_PURPOSES = [
  "analytics",
  "marketing_email",
  "sale_or_share",
  "messaging_tcpa",
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export interface ConsentState {
  /** US opt-out model: allowed with notice unless opted out. */
  analytics: boolean;
  /** Opt-in. */
  marketing_email: boolean;
  /** CCPA "Do Not Sell or Share": true = user permits sale/share. */
  sale_or_share: boolean;
  /** TCPA prior express consent for marketing messages. */
  messaging_tcpa: boolean;
  /** Global Privacy Control signal observed. */
  gpc: boolean;
}

export interface ConsentRecord {
  tenantId: TenantId;
  /** anonymousId or hashed email. */
  subject: string;
  state: ConsentState;
  /** "banner" | "preference_center" | "gpc" | "api" */
  source: string;
  ts: string;
  /** hash-chain over previous record (law-agnostic ledger). */
  prevHash: string;
  hash: string;
  /** Ed25519 signature, attached by the consent module. */
  sig?: string;
}

export interface ModuleManifest {
  key: ModuleKey;
  title: string;
  description: string;
  /** Consent purposes this module requires before it may act. */
  requiresConsent: ConsentPurpose[];
}

// ---- Tenant ----
export interface Tenant {
  id: TenantId;
  name: string;
  /** Public key embedded in the on-site SDK. */
  writeKey: string;
  /** US-only system. */
  region: "us";
  enabledModules: ModuleKey[];
  createdAt: string;
}

// ---- B2B Profile ----
export interface Firmographics {
  company?: string;
  domain?: string;
  industry?: string;
  employeeRange?: string;
  /** Sensitive PI under CPRA — requires consent to process. */
  revenueRange?: string;
  country?: string;
}

export interface IntentSignals {
  /** 0..100 buying intent. */
  score?: number;
  topics?: string[];
  lastActiveAt?: string;
}

export interface Profile {
  id: ProfileId;
  tenantId: TenantId;
  anonymousId?: string;
  /** The tenant's own user id once identified. */
  userId?: string;
  email?: string;
  firmographics: Firmographics;
  intent: IntentSignals;
  traits: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ---- Ingest events (on-site SDK -> /v1/track) ----
export const identifyEventSchema = z.object({
  type: z.literal("identify"),
  anonymousId: z.string().min(1),
  userId: z.string().optional(),
  traits: z.record(z.unknown()).default({}),
  ts: z.string().datetime().optional(),
});

export const trackEventSchema = z.object({
  type: z.literal("track"),
  anonymousId: z.string().min(1),
  event: z.string().min(1),
  properties: z.record(z.unknown()).default({}),
  ts: z.string().datetime().optional(),
});

export const ingestEventSchema = z.discriminatedUnion("type", [
  identifyEventSchema,
  trackEventSchema,
]);
export type IngestEvent = z.infer<typeof ingestEventSchema>;
export type IdentifyEvent = z.infer<typeof identifyEventSchema>;
export type TrackEvent = z.infer<typeof trackEventSchema>;

export const ingestBatchSchema = z.object({
  writeKey: z.string().min(1),
  events: z.array(ingestEventSchema).min(1).max(500),
});
export type IngestBatch = z.infer<typeof ingestBatchSchema>;
