import type { IngestEvent } from "@cdp-us/contracts";

/** @example const field: FormField = { name: "email", type: "email", required: true }; */
export type FormField = Readonly<{ name: string; type: "email" | "text" | "number" | "select" | "checkbox"; required?: boolean; options?: readonly string[]; consent?: boolean }>;

/** @example const def: FormDefinition = { key: "demo", fields: [{ name: "email", type: "email" }] }; */
export type FormDefinition = Readonly<{ key: string; fields: readonly FormField[] }>;

/** @example const issue: ValidationIssue = { field: "email", code: "invalid_email" }; */
export type ValidationIssue = Readonly<{ field: string; code: string }>;

/** @example const result: ValidationResult = { ok: true, issues: [] }; */
export type ValidationResult = Readonly<{ ok: boolean; issues: readonly ValidationIssue[] }>;

/** @example const values: SubmissionValues = { email: "buyer@example.com" }; */
export type SubmissionValues = Readonly<Record<string, unknown>>;

/** @example const result = validateSubmission(def, values); */
export function validateSubmission(def: FormDefinition, values: SubmissionValues): ValidationResult {
  const issues = def.fields.flatMap((field) => validateField(field, values[field.name]));
  return { ok: issues.length === 0, issues };
}

/** @example const events = submissionToEvents(def, values, "anon_1"); */
export function submissionToEvents(def: FormDefinition, values: SubmissionValues, anonymousId: string): readonly IngestEvent[] {
  if (!validateSubmission(def, values).ok) return [];
  const normalized = normalizedValues(def, values);
  const identify: IngestEvent = { type: "identify", anonymousId, traits: contactTraits(def, normalized) };
  const track: IngestEvent = { type: "track", anonymousId, event: "Form Submitted", properties: { formKey: def.key, fields: normalized, consent: consentValue(def, normalized) } };
  return [identify, track];
}

/** @example const field = consentField(def); */
export function consentField(def: FormDefinition): FormField | null {
  return def.fields.find((field) => field.type === "checkbox" && (field.consent || /consent|notice|privacy/i.test(field.name))) ?? null;
}

function validateField(field: FormField, value: unknown): readonly ValidationIssue[] {
  if (field.required && empty(value)) return [{ field: field.name, code: "required" }];
  if (empty(value)) return [];
  if (field.type === "email" && !normalizeEmail(value)) return [{ field: field.name, code: "invalid_email" }];
  if (field.type === "number" && typeof value !== "number") return [{ field: field.name, code: "invalid_number" }];
  if (field.type === "select" && !field.options?.includes(String(value))) return [{ field: field.name, code: "invalid_option" }];
  if (field.type === "checkbox" && typeof value !== "boolean") return [{ field: field.name, code: "invalid_checkbox" }];
  return [];
}

function normalizedValues(def: FormDefinition, values: SubmissionValues): Record<string, unknown> {
  return Object.fromEntries(def.fields.map((field) => [field.name, normalizeValue(field, values[field.name])]).filter((entry) => entry[1] !== undefined));
}

function normalizeValue(field: FormField, value: unknown): unknown {
  if (empty(value)) return undefined;
  if (field.type === "email") return normalizeEmail(value);
  if (field.type === "text" || field.type === "select") return String(value).trim();
  return value;
}

function contactTraits(def: FormDefinition, values: Record<string, unknown>): Record<string, unknown> {
  const traits: Record<string, unknown> = {};
  for (const field of def.fields) if (field.type === "email" || /name|company|phone|title/i.test(field.name)) traits[field.name] = values[field.name];
  return traits;
}

function consentValue(def: FormDefinition, values: Record<string, unknown>): boolean | undefined {
  const field = consentField(def);
  return field ? values[field.name] === true : undefined;
}

function normalizeEmail(value: unknown): string | null {
  const email = String(value).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function empty(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}
