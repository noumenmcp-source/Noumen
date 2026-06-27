import type { ConsentState, IngestEvent, Profile, TenantId } from "@cdp-us/contracts";

/** @example const subject: Subject = { email: "buyer@example.com" }; */
export type Subject = Readonly<{ email?: string; userId?: string; anonymousId?: string }>;

/** @example const request: DsarRequest = { tenantId: "tenant_1", subject, requestedAt: "2026-06-01T00:00:00.000Z" }; */
export type DsarRequest = Readonly<{
  tenantId: TenantId;
  subject: Subject;
  requestedAt: string;
  legalHolds?: readonly LegalHold[];
}>;

/** @example const reader: ProfileReader = { getBySubject: async () => null }; */
export type ProfileReader = Readonly<{
  getBySubject(tenantId: TenantId, subject: Subject): MaybePromise<Profile | null>;
}>;

/** @example const reader: EventReader = { listBySubject: async () => [] }; */
export type EventReader = Readonly<{
  listBySubject(tenantId: TenantId, subject: Subject): MaybePromise<readonly IngestEvent[]>;
}>;

/** @example const reader: ConsentReader = { getState: async () => null }; */
export type ConsentReader = Readonly<{
  getState(tenantId: TenantId, subject: Subject): MaybePromise<ConsentState | null>;
}>;

/** @example const readers: DsarReaders = { profiles, events, consent }; */
export type DsarReaders = Readonly<{
  profiles: ProfileReader;
  events: EventReader;
  consent: ConsentReader;
}>;

/** @example const category: CcpaCategory = "identifiers"; */
export type CcpaCategory = "identifiers" | "commercial" | "internet_activity" | "inferences";

/** @example const item: ReportItem = { source: "profile", field: "email", value: "a@example.com" }; */
export type ReportItem = Readonly<{ source: "profile" | "event" | "consent"; field: string; value: unknown }>;

/**
 * @example
 * const report = await assembleAccessReport(readers, request);
 */
export type AccessReport = Readonly<{
  schemaVersion: typeof ACCESS_REPORT_SCHEMA_VERSION;
  tenantId: TenantId;
  subject: Subject;
  requestedAt: string;
  categories: Record<CcpaCategory, readonly ReportItem[]>;
}>;

/** @example const hold: LegalHold = { target: "event", key: "Purchase Completed", reason: "Transaction retention" }; */
export type LegalHold = Readonly<{ target: DeletionTargetType; key?: string; reason: string }>;

/** @example const target: DeletionTarget = { type: "profile", key: "profile_1", action: "delete", legalHold: false }; */
export type DeletionTarget = Readonly<{
  type: DeletionTargetType;
  key: string;
  action: "delete" | "anonymize" | "retain";
  legalHold: boolean;
  reason?: string;
}>;

/**
 * @example
 * const plan = await planDeletion(readers, request);
 */
export type DeletionPlan = Readonly<{
  tenantId: TenantId;
  subject: Subject;
  requestedAt: string;
  targets: readonly DeletionTarget[];
  deletableTargets: readonly DeletionTarget[];
}>;

/** @example const type: DeletionTargetType = "derived"; */
export type DeletionTargetType = "profile" | "event" | "derived";

/** @example const version = ACCESS_REPORT_SCHEMA_VERSION; */
export const ACCESS_REPORT_SCHEMA_VERSION = "2026-06-ccpa-dsar-v1";

export type MaybePromise<T> = T | Promise<T>;
