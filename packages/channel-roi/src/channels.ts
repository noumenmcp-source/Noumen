import type { CanonicalChannel, ChannelKey } from "./types.js";

const SEARCH_ENGINES = new Set([
  "google", "bing", "yahoo", "duckduckgo", "yandex", "ecosia", "baidu", "ask", "brave",
]);
const SOCIAL_SOURCES = new Set([
  "facebook", "instagram", "meta", "linkedin", "twitter", "x", "tiktok",
  "pinterest", "reddit", "youtube", "snapchat", "threads",
]);
const EMAIL_SOURCES = new Set(["email", "newsletter", "klaviyo", "mailchimp", "sendgrid", "hubspot-email"]);

const SOURCE_ALIASES: Record<string, string> = {
  fb: "facebook", "facebook.com": "facebook", "m.facebook.com": "facebook", "fb.com": "facebook",
  ig: "instagram", "instagram.com": "instagram",
  metaads: "meta", "meta ads": "meta",
  "google.com": "google", googleads: "google", "google ads": "google", adwords: "google", gads: "google",
  "bing.com": "bing", msn: "bing",
  "linkedin.com": "linkedin", "lnkd.in": "linkedin",
  "t.co": "twitter", "twitter.com": "twitter", "x.com": "x",
  yt: "youtube", "youtube.com": "youtube",
  "tiktok.com": "tiktok",
};

const MEDIUM_ALIASES: Record<string, string> = {
  ppc: "cpc", paidsearch: "cpc", "paid-search": "cpc", paid_search: "cpc", sem: "cpc",
  paidsocial: "paid_social", "paid-social": "paid_social", "social-paid": "paid_social",
  "organic-social": "social", "social-network": "social", social_network: "social",
  "e-mail": "email", newsletter: "email",
  banner: "display", cpm: "display",
  aff: "affiliate", affiliates: "affiliate", partner: "affiliate",
};

const PAID_MEDIUM = /^(cpc|ppc|cpm|cpv|paid|paid_social|display|retargeting|remarketing)$/;
const DIRECT_SOURCE = new Set(["", "(direct)", "direct"]);
const NONE_MEDIUM = new Set(["", "(none)", "(not set)", "none"]);

/** Lowercase, trim, collapse whitespace, strip surrounding quotes. */
export function cleanUtm(value: string | undefined | null): string {
  if (value == null) return "";
  return value.trim().toLowerCase().replace(/^["']|["']$/g, "").replace(/\s+/g, " ");
}

/** Resolve a cleaned source through the alias table (fb → facebook, …). */
export function resolveSource(raw: string | undefined | null): string {
  const s = cleanUtm(raw);
  return SOURCE_ALIASES[s] ?? s;
}

/** Resolve a cleaned medium through the alias table (ppc → cpc, …). */
export function resolveMedium(raw: string | undefined | null): string {
  const m = cleanUtm(raw);
  return MEDIUM_ALIASES[m] ?? m;
}

/**
 * Classify a cleaned (source, medium) into a canonical channel, GA4
 * default-channel-grouping style. Order matters — most specific first.
 * @example classifyChannel("google", "cpc") // => "paid_search"
 */
export function classifyChannel(source: string, medium: string, campaign?: string): CanonicalChannel {
  const s = resolveSource(source);
  const m = resolveMedium(medium);
  const isSearch = SEARCH_ENGINES.has(s);
  const isSocial = SOCIAL_SOURCES.has(s);
  const isPaid = PAID_MEDIUM.test(m);

  if (m === "affiliate") return "affiliate";
  if (m === "email" || EMAIL_SOURCES.has(s)) return "email";
  if (m === "display") return "display";
  if (m === "video" || m === "cpv") return "video";
  if (m === "paid_social" || (isPaid && isSocial)) return "paid_social";
  if (isPaid && (isSearch || m === "cpc" || m === "ppc")) return "paid_search";
  if (isSearch && (m === "organic" || NONE_MEDIUM.has(m))) return "organic_search";
  if (isSocial && (m === "social" || m === "organic" || NONE_MEDIUM.has(m))) return "organic_social";
  if (m === "referral") return "referral";
  if (DIRECT_SOURCE.has(s) && NONE_MEDIUM.has(m)) return "direct";
  return "other";
}

/** Build a full canonical ChannelKey from raw UTM parts. */
export function channelKey(source: string | undefined, medium: string | undefined, campaign?: string): ChannelKey {
  const src = resolveSource(source);
  const med = resolveMedium(medium);
  const camp = cleanUtm(campaign);
  return { channel: classifyChannel(src, med, camp), source: src, medium: med, ...(camp ? { campaign: camp } : {}) };
}

/** Parse a GA4-style "source / medium" string into a ChannelKey. */
export function channelKeyFromSourceMedium(sourceMedium: string | undefined, campaign?: string): ChannelKey {
  const [source, medium] = cleanUtm(sourceMedium).split("/").map((p) => p.trim());
  return channelKey(source ?? "", medium ?? "", campaign);
}
