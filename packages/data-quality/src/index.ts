import type { IngestEvent, Profile } from "@cdp-us/contracts";

/** @example const issue: Issue = { code: "invalid_email", severity: "error", field: "email" }; */
export type Issue = Readonly<{ code: string; severity: "info" | "warn" | "error"; field?: string }>;

/** @example const issues = validateEvent({ type: "track", anonymousId: "a", event: "Viewed" }); */
export function validateEvent(event: IngestEvent): readonly Issue[] {
  const issues: Issue[] = [];
  if (!event.anonymousId.trim()) issues.push(error("missing_anonymous_id", "anonymousId"));
  if (event.type === "track" && !validEventName(event.event)) issues.push(error("invalid_event_name", "event"));
  if (event.type === "track" && !validRecord(event.properties)) issues.push(error("invalid_properties", "properties"));
  if (event.type === "identify" && !validRecord(event.traits)) issues.push(error("invalid_traits", "traits"));
  return issues;
}

/** @example const issues = validateProfile(profile); */
export function validateProfile(profile: Profile): readonly Issue[] {
  const issues: Issue[] = [];
  if (profile.email && !normalizeEmail(profile.email)) issues.push(error("invalid_email", "email"));
  if (profile.firmographics.domain && !validDomain(profile.firmographics.domain)) issues.push(error("invalid_domain", "firmographics.domain"));
  if (!profile.userId && !profile.email && !profile.anonymousId) issues.push(error("missing_identifier"));
  if (phoneValue(profile.traits) && !normalizePhone(phoneValue(profile.traits) ?? "")) issues.push(error("invalid_phone", "traits.phone"));
  return issues;
}

/** @example const email = normalizeEmail("Foo@BAR.com "); */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** @example const phone = normalizePhone("(415) 555-0101"); */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** @example const key = dedupeKey(profile); */
export function dedupeKey(profile: Profile): string {
  const email = profile.email ? normalizeEmail(profile.email) : null;
  if (profile.userId) return `user:${profile.userId}`;
  if (email) return `email:${email}`;
  if (profile.anonymousId) return `anonymous:${profile.anonymousId}`;
  return `profile:${profile.id}`;
}

/** @example const score = scoreQuality(profile); */
export function scoreQuality(profile: Profile): number {
  const completeness = completenessScore(profile);
  const penalty = validateProfile(profile).filter((issue) => issue.severity === "error").length * 20;
  return clamp(completeness - penalty, 0, 100);
}

function completenessScore(profile: Profile): number {
  const fields = [profile.userId, profile.email, profile.anonymousId, profile.firmographics.company, profile.firmographics.domain];
  const present = fields.filter((value) => typeof value === "string" && value.trim()).length;
  return Math.round((present / fields.length) * 100);
}

function validEventName(value: string): boolean {
  return /^[A-Z][A-Za-z0-9]*(?: [A-Z][A-Za-z0-9]*)*$/.test(value);
}

function validRecord(value: unknown): boolean {
  return value === undefined || (value !== null && typeof value === "object" && !Array.isArray(value));
}

function validDomain(value: string): boolean {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value.trim());
}

function phoneValue(traits: Record<string, unknown>): string | null {
  const value = traits.phone;
  return typeof value === "string" ? value : null;
}

function error(code: string, field?: string): Issue {
  return { code, severity: "error", field };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
