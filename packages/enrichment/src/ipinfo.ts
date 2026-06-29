import type { EnrichmentKey, EnrichmentProvider, FirmographicData } from "./index.js";

/** @example const provider = createIpinfoProvider({ token: process.env.IPINFO_TOKEN }); */
export type IpinfoOptions = Readonly<{ token?: string; fetchImpl?: typeof fetch }>;

/**
 * IPinfo.io enrichment provider: resolves an IP to a company + country.
 *
 * Only handles `type: "ip"` keys. The token is read from `opts.token` or the
 * `IPINFO_TOKEN` env var; with no token it is a no-op (returns null) so the
 * provider can be wired unconditionally and activated by setting the env var.
 *
 * `org` arrives as "AS15169 Google LLC" — the AS prefix is stripped to the
 * company name. The reverse-DNS `hostname` is intentionally ignored: a PTR
 * record is not a reliable firmographic domain.
 */
export function createIpinfoProvider(opts?: IpinfoOptions): EnrichmentProvider {
  return {
    source: "ipinfo",
    async lookup(key: EnrichmentKey): Promise<FirmographicData | null> {
      if (key.type !== "ip") return null;
      const token = opts?.token ?? process.env.IPINFO_TOKEN;
      if (!token) return null;

      const fetchImpl = opts?.fetchImpl ?? fetch;
      const response = await fetchImpl(
        `https://ipinfo.io/${encodeURIComponent(key.value)}/json?token=${encodeURIComponent(token)}`,
      );
      if (!response.ok) return null;

      const data = (await response.json()) as { org?: string; country?: string };
      const company = data.org?.replace(/^AS\d+\s+/, "").trim();
      const country = data.country?.trim();
      if (!company && !country) return null;

      return { ...(company ? { company } : {}), ...(country ? { country } : {}) };
    },
  };
}
