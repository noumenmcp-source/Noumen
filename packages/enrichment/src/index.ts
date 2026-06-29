import type { Firmographics, Profile } from "@cdp-us/contracts";

/** @example const key: EnrichmentKey = { type: "domain", value: "acme.com" }; */
export type EnrichmentKey = Readonly<{ type: "domain" | "ip" | "email"; value: string }>;

/** @example const data: FirmographicData = { company: "Acme", industry: "software" }; */
export type FirmographicData = Firmographics;

/** @example const provider: EnrichmentProvider = { lookup: async () => null }; */
export type EnrichmentProvider = Readonly<{ source: string; lookup(key: EnrichmentKey): Promise<FirmographicData | null> }>;

/** @example const opts: EnrichmentOptions = { preferExisting: true, includeSensitive: false }; */
export type EnrichmentOptions = Readonly<{ preferExisting?: boolean; includeSensitive?: boolean }>;

export { createIpinfoProvider, type IpinfoOptions } from "./ipinfo.js";

const FREE_MAIL = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "aol.com", "proton.me"]);

/** @example const domain = deriveDomain(profile); */
export function deriveDomain(profile: Profile): string | null {
  const firmographicDomain = normalizeDomain(profile.firmographics.domain);
  if (firmographicDomain) return firmographicDomain;
  const emailDomain = profile.email?.split("@")[1] ?? "";
  const domain = normalizeDomain(emailDomain);
  return domain && !FREE_MAIL.has(domain) ? domain : null;
}

/** @example const firmographics = normalizeFirmographics({ industry: "SaaS", employeeRange: "11-50" }); */
export function normalizeFirmographics(raw: FirmographicData): Firmographics {
  const normalized: Firmographics = {};
  if (raw.company?.trim()) normalized.company = raw.company.trim();
  if (raw.domain) normalized.domain = normalizeDomain(raw.domain) ?? undefined;
  if (raw.industry) normalized.industry = normalizeIndustry(raw.industry);
  if (raw.employeeRange) normalized.employeeRange = normalizeEmployeeRange(raw.employeeRange);
  if (raw.revenueRange) normalized.revenueRange = normalizeRevenueRange(raw.revenueRange);
  if (raw.country?.trim()) normalized.country = raw.country.trim().toUpperCase();
  return normalized;
}

/** @example const enriched = await enrichProfile(profile, [provider]); */
export async function enrichProfile(
  profile: Profile,
  providers: readonly EnrichmentProvider[],
  opts: EnrichmentOptions = {},
): Promise<Profile> {
  const collected: Firmographics[] = [];
  for (const key of lookupKeys(profile)) {
    for (const provider of providers) {
      const result = await provider.lookup(key);
      if (result) collected.push(normalizeFirmographics(result));
    }
  }
  const merged = collected.reduce((acc, item) => mergeFirmographics(acc, item, opts), { ...profile.firmographics });
  return { ...profile, firmographics: stripSensitive(normalizeFirmographics(merged), opts) };
}

function lookupKeys(profile: Profile): readonly EnrichmentKey[] {
  const keys: EnrichmentKey[] = [];
  const domain = deriveDomain(profile);
  if (domain) keys.push({ type: "domain", value: domain });
  if (profile.email) keys.push({ type: "email", value: profile.email.trim().toLowerCase() });
  const ip = stringTrait(profile, "ip") ?? stringTrait(profile, "ipAddress");
  if (ip) keys.push({ type: "ip", value: ip });
  return keys;
}

function mergeFirmographics(base: Firmographics, next: Firmographics, opts: EnrichmentOptions): Firmographics {
  const out: Firmographics = { ...base };
  for (const key of ["company", "domain", "industry", "employeeRange", "revenueRange", "country"] as const) {
    if (next[key] && (!opts.preferExisting || !out[key])) out[key] = next[key];
  }
  return out;
}

function stripSensitive(value: Firmographics, opts: EnrichmentOptions): Firmographics {
  if (opts.includeSensitive) return value;
  const { revenueRange: _revenueRange, ...rest } = value;
  return rest;
}

function normalizeDomain(raw: string | undefined): string | null {
  const domain = raw?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "";
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) ? domain : null;
}

function normalizeIndustry(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (["saas", "software", "technology", "tech"].includes(value)) return "software";
  if (["finance", "fintech", "financial services"].includes(value)) return "financial_services";
  if (["health", "healthcare", "medical"].includes(value)) return "healthcare";
  return value.replace(/\s+/g, "_");
}

function normalizeEmployeeRange(raw: string): string {
  const value = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (/^(1-10|0-10)$/.test(value)) return "1-10";
  if (/^(11-50|10-50)$/.test(value)) return "11-50";
  if (/^(51-200|50-200)$/.test(value)) return "51-200";
  if (/^(201-1000|200-1000)$/.test(value)) return "201-1000";
  return "1001+";
}

function normalizeRevenueRange(raw: string): string {
  const value = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (value.includes("<") || value.startsWith("under")) return "<1m";
  if (value.includes("50m+") || value.endsWith("+")) return "50m+";
  if (value.includes("50m")) return "10m-50m";
  if (value.includes("10m")) return "1m-10m";
  return "50m+";
}

function stringTrait(profile: Profile, key: string): string | null {
  const value = profile.traits[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
