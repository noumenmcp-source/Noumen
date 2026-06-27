/** @example const opts: SpfOptions = { includes: ["sendgrid.net"], ip4: ["192.0.2.10"] }; */
export type SpfOptions = Readonly<{ includes?: readonly string[]; ip4?: readonly string[]; ip6?: readonly string[]; all?: "-all" | "~all" }>;

/** @example const opts: DmarcOptions = { policy: "quarantine", rua: "mailto:dmarc@example.com" }; */
export type DmarcOptions = Readonly<{ policy: "none" | "quarantine" | "reject"; rua?: string; pct?: number }>;

/** @example const parsed = parseSpf("v=spf1 include:_spf.example.com -all"); */
export type SpfRecord = Readonly<{ valid: boolean; mechanisms: readonly string[]; all?: string }>;

/** @example const report: AuthReport = checkAuthRecords({ spf: "v=spf1 -all", dmarc: "v=DMARC1; p=reject", dkim: ["s1"] }); */
export type AuthReport = Readonly<{ spfAligned: boolean; dmarcAligned: boolean; dkimAligned: boolean; warnings: readonly string[] }>;

/** @example const event: DeliveryEvent = { type: "bounce", code: "550" }; */
export type DeliveryEvent = Readonly<{ type?: string; code?: string; reason?: string; email?: string }>;

/** @example const entry: SuppressionEntry = { email: "buyer@example.com", reason: "hard-bounce" }; */
export type SuppressionEntry = Readonly<{ email: string; reason: "hard-bounce" | "complaint" | "unsubscribe" }>;

/** @example const store = new InMemorySuppressionStore(); */
export interface SuppressionStore {
  add(entry: SuppressionEntry): Promise<void>;
  get(email: string): Promise<SuppressionEntry | null>;
}

/** @example const parsed = parseSpf("v=spf1 include:sendgrid.net -all"); */
export function parseSpf(txt: string): SpfRecord {
  const parts = txt.trim().split(/\s+/);
  if (parts[0]?.toLowerCase() !== "v=spf1") return { valid: false, mechanisms: [] };
  const mechanisms = parts.slice(1);
  const all = mechanisms.find((part) => ["-all", "~all", "?all", "+all"].includes(part));
  return { valid: true, mechanisms, all };
}

/** @example const txt = buildSpf({ includes: ["sendgrid.net"], all: "-all" }); */
export function buildSpf(opts: SpfOptions): string {
  const parts = ["v=spf1", ...(opts.includes ?? []).map((item) => `include:${item}`), ...(opts.ip4 ?? []).map((item) => `ip4:${item}`)];
  parts.push(...(opts.ip6 ?? []).map((item) => `ip6:${item}`), opts.all ?? "~all");
  return parts.join(" ");
}

/** @example const txt = buildDmarc({ policy: "reject", pct: 100 }); */
export function buildDmarc(opts: DmarcOptions): string {
  const parts = ["v=DMARC1", `p=${opts.policy}`];
  if (opts.rua) parts.push(`rua=${opts.rua}`);
  if (opts.pct !== undefined) parts.push(`pct=${Math.max(0, Math.min(100, Math.round(opts.pct)))}`);
  return parts.join("; ");
}

/** @example const ok = validateDkimSelector("marketing-2026"); */
export function validateDkimSelector(selector: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,62}$/i.test(selector.trim());
}

/** @example const report = checkAuthRecords({ spf: "v=spf1 -all", dmarc: "v=DMARC1; p=reject", dkim: ["s1"] }); */
export function checkAuthRecords(records: { readonly spf?: string; readonly dmarc?: string; readonly dkim?: readonly string[] }): AuthReport {
  const spf = records.spf ? parseSpf(records.spf) : { valid: false, mechanisms: [] };
  const dmarcPolicy = records.dmarc?.match(/\bp=(none|quarantine|reject)\b/i)?.[1]?.toLowerCase();
  const warnings = [
    ...(!spf.valid ? ["missing_spf"] : []),
    ...(spf.all !== "-all" ? ["weak_spf_all"] : []),
    ...(!dmarcPolicy ? ["missing_dmarc"] : []),
    ...(dmarcPolicy === "none" ? ["monitor_only_dmarc"] : []),
    ...(!(records.dkim ?? []).some(validateDkimSelector) ? ["missing_dkim"] : []),
  ];
  return { spfAligned: spf.valid && spf.all === "-all", dmarcAligned: dmarcPolicy === "quarantine" || dmarcPolicy === "reject", dkimAligned: !(warnings.includes("missing_dkim")), warnings };
}

/** @example const kind = classifyBounce({ type: "bounce", code: "550" }); */
export function classifyBounce(event: DeliveryEvent): "hard" | "soft" | "complaint" | "unknown" {
  const type = event.type?.toLowerCase() ?? "";
  const code = event.code ?? "";
  const reason = event.reason?.toLowerCase() ?? "";
  if (type.includes("complaint") || reason.includes("complaint") || reason.includes("abuse")) return "complaint";
  if (/^5\d\d/.test(code) || reason.includes("permanent") || reason.includes("hard")) return "hard";
  if (/^4\d\d/.test(code) || reason.includes("temporary") || reason.includes("soft")) return "soft";
  return "unknown";
}

/** @example const store = new InMemorySuppressionStore([{ email: "a@example.com", reason: "unsubscribe" }]); */
export class InMemorySuppressionStore implements SuppressionStore {
  private readonly entries = new Map<string, SuppressionEntry>();

  constructor(entries: readonly SuppressionEntry[] = []) {
    for (const entry of entries) this.entries.set(normalizeEmail(entry.email), { ...entry, email: normalizeEmail(entry.email) });
  }

  async add(entry: SuppressionEntry): Promise<void> {
    this.entries.set(normalizeEmail(entry.email), { ...entry, email: normalizeEmail(entry.email) });
  }

  async get(email: string): Promise<SuppressionEntry | null> {
    return this.entries.get(normalizeEmail(email)) ?? null;
  }
}

/** @example const blocked = await shouldSuppress("buyer@example.com", store); */
export async function shouldSuppress(email: string, store: SuppressionStore): Promise<boolean> {
  const entry = await store.get(email);
  return entry?.reason === "hard-bounce" || entry?.reason === "complaint" || entry?.reason === "unsubscribe";
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
