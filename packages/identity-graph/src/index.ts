import type { Profile } from "@cdp-us/contracts";

/** @example const account: Account = { key: "acme.com", domain: "acme.com", memberIds: ["p1"], primaryProfileId: "p1" }; */
export type Account = Readonly<{ key: string; domain: string; memberIds: readonly string[]; primaryProfileId: string; company?: string }>;

/** @example const graph: AccountGraph = buildAccountGraph(profiles); */
export type AccountGraph = Readonly<{ accounts: readonly Account[] }>;

const FREE_MAIL = new Set(["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "aol.com"]);

/** @example const key = accountKeyFor(profile); */
export function accountKeyFor(profile: Profile): string | null {
  const domain = domainOf(profile.email) ?? cleanDomain(profile.firmographics.domain);
  return domain && !FREE_MAIL.has(domain) ? domain : null;
}

/** @example const graph = buildAccountGraph(profiles); */
export function buildAccountGraph(profiles: readonly Profile[]): AccountGraph {
  const groups = new Map<string, Profile[]>();
  for (const profile of profiles) {
    const key = accountKeyFor(profile);
    if (key) groups.set(key, [...(groups.get(key) ?? []), profile]);
  }
  return { accounts: [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([domain, list]) => account(domain, list)) };
}

/** @example const account = accountOf(graph, "profile_1"); */
export function accountOf(graph: AccountGraph, profileId: string): Account | null {
  return graph.accounts.find((item) => item.memberIds.includes(profileId)) ?? null;
}

/** @example const ids = members(graph, "acme.com"); */
export function members(graph: AccountGraph, accountKey: string): readonly string[] {
  return graph.accounts.find((item) => item.key === accountKey)?.memberIds ?? [];
}

function account(domain: string, profiles: readonly Profile[]): Account {
  const sorted = [...profiles].sort((a, b) => a.id.localeCompare(b.id));
  const primary = [...profiles].sort(byCompletenessThenCreated)[0];
  return { key: domain, domain, memberIds: sorted.map((profile) => profile.id), primaryProfileId: primary.id, company: primary.firmographics.company };
}

function byCompletenessThenCreated(a: Profile, b: Profile): number {
  const diff = completeness(b) - completeness(a);
  return diff || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

function completeness(profile: Profile): number {
  return [profile.email, profile.userId, profile.firmographics.company, profile.firmographics.domain].filter(Boolean).length;
}

function domainOf(email?: string): string | null {
  const domain = email?.split("@")[1];
  return cleanDomain(domain);
}

function cleanDomain(domain?: string): string | null {
  const clean = domain?.trim().toLowerCase();
  return clean && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean) ? clean : null;
}
