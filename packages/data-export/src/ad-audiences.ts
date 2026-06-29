import { createHash } from "node:crypto";

/**
 * Hashed audience export for ad platforms. Meta Custom Audiences and Google
 * Customer Match both expect identifiers normalized then SHA-256 hashed (lower
 * hex), so a tenant can build a match audience without ever shipping raw PII to
 * the ad network. Uploading the file needs ad-account credentials; building it
 * does not.
 */
export type AdPlatform = "meta" | "google";

export interface AdAudienceRow {
  readonly email?: string;
  readonly phone?: string;
}

export interface AdAudienceCsvOptions {
  /** Include a hashed phone column (E.164-normalized). Default false (email-only). */
  readonly includePhone?: boolean;
}

/** Email normalization shared by both platforms: trim + lowercase. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Phone → E.164-ish: keep a leading "+", strip every other non-digit. */
export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  const digits = trimmed.replace(/\D/g, "");
  return digits ? `${plus}${digits}` : "";
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** SHA-256 (lower hex) of the normalized email, or "" if blank. */
export function hashEmail(email: string): string {
  const normalized = normalizeEmail(email);
  return normalized ? sha256Hex(normalized) : "";
}

/** SHA-256 (lower hex) of the E.164-normalized phone, or "" if blank. */
export function hashPhone(phone: string): string {
  const normalized = normalizePhone(phone);
  return normalized ? sha256Hex(normalized) : "";
}

/** Platform-specific CSV column headers (same hashing, different labels). */
const HEADERS: Record<AdPlatform, { email: string; phone: string }> = {
  meta: { email: "email", phone: "phone" },
  google: { email: "Email", phone: "Phone" },
};

/**
 * Build a hashed-identifier CSV for the given ad platform. Rows with no usable
 * identifier are skipped; duplicate hashed emails are de-duplicated. All values
 * are hex (or empty), so no CSV escaping is required.
 *
 * @example buildAdAudienceCsv([{ email: "a@b.com" }], "meta") // "email\n<sha256>"
 */
export function buildAdAudienceCsv(
  rows: readonly AdAudienceRow[],
  platform: AdPlatform,
  options: AdAudienceCsvOptions = {},
): string {
  const cols = HEADERS[platform];
  const includePhone = options.includePhone ?? false;
  const header = includePhone ? `${cols.email},${cols.phone}` : cols.email;

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const row of rows) {
    const email = row.email ? hashEmail(row.email) : "";
    const phone = includePhone && row.phone ? hashPhone(row.phone) : "";
    if (!email && !phone) continue;
    // De-dupe on the full row key so email-only and email+phone don't collide.
    const dedupeKey = `${email}|${phone}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    lines.push(includePhone ? `${email},${phone}` : email);
  }

  return [header, ...lines].join("\n");
}
