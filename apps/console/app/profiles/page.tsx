"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MiniSpark, StatTile } from "../../src/charts";
import { Badge, EmptyState, ErrorState, Shell } from "../../src/ui";
import { getProfiles } from "../../src/api";
import { intentTier, intentValue } from "../../src/format";
import { readSession } from "../../src/session";
import type { Profile, Session } from "../../src/types";

function num(v: unknown): number { return typeof v === "number" && Number.isFinite(v) ? v : 0; }
const usd = (v: number) => `$${Math.round(v).toLocaleString()}`;

export default function ProfilesPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [profiles, setProfiles] = useState<readonly Profile[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const s = readSession();
    setSession(s);
    if (!s) { setLoading(false); return; }
    getProfiles(s.tenantId, s.apiToken)
      .then((list) =>
        setProfiles([...list].sort((a, b) => intentValue(b.intent.score) - intentValue(a.intent.score)))
      )
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed."))
      .finally(() => setLoading(false));
  }, []);

  if (!session && !loading) return <Shell><EmptyState title="No session" body="Sign in to view profiles." /></Shell>;
  if (loading) return <Shell><EmptyState title="Loading profiles…" body="Ranking by intent score." /></Shell>;
  if (error) return <Shell><ErrorState message={error} /></Shell>;
  if (!profiles.length) return <Shell><EmptyState title="No profiles yet" body="Profiles appear as events are ingested." /></Shell>;

  const vipCount = profiles.filter((p) => intentValue(p.intent.score) >= 7).length;
  const totalOrders = profiles.reduce((s, p) => s + num((p as unknown as Record<string, Record<string, unknown>>)?.traits?.orders), 0);
  const avgOrders = profiles.length ? (totalOrders / profiles.length).toFixed(1) : "0";
  const totalRev = profiles.reduce((s, p) => s + num((p as unknown as Record<string, Record<string, unknown>>)?.traits?.revenue), 0);
  const avgRev = profiles.length ? Math.round(totalRev / profiles.length) : 0;

  return (
    <Shell>
      <div className="mb-6">
        <p className="label text-muted">Customer profiles</p>
        <h1 className="mt-1 font-serif text-3xl font-bold leading-tight text-ink">
          Your base. <span className="text-muted text-xl font-normal font-sans">{profiles.length.toLocaleString()} profiles</span>
        </h1>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total profiles" value={profiles.length.toLocaleString()} hint="ranked by intent" tone="ink" />
        <StatTile label="VIP" value={vipCount.toLocaleString()} hint="intent score ≥ 7" tone="gold" />
        <StatTile label="Avg orders" value={avgOrders} hint="per profile" tone="sage" />
        <StatTile label="Avg revenue" value={usd(avgRev)} hint="per profile" tone="rust" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {profiles.slice(0, 50).map((profile) => {
          const tier = intentTier(profile.intent.score);
          const score = intentValue(profile.intent.score);
          const spark = [1, 2, 2, 3, 3, 4, 5, Math.max(1, Math.round(score))];
          const traits = (profile as unknown as Record<string, Record<string, unknown>>)?.traits ?? {};
          const geo = (profile as unknown as Record<string, Record<string, unknown>>)?.firmographics ?? {};
          return (
            <Link
              key={profile.id}
              href={`/profiles/${profile.id}`}
              className="block rounded-lg border border-line bg-panel p-4 shadow-card transition-colors hover:border-gold"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="truncate font-semibold text-ink">
                  {profile.email ?? profile.anonymousId ?? profile.id.slice(0, 16)}
                </p>
                <Badge tone={tier.tone}>{tier.label}</Badge>
              </div>
              <p className="mt-0.5 text-sm text-muted">
                {String(geo.company ?? "Unknown company")}
                {geo.industry ? ` · ${String(geo.industry)}` : ""}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted">
                {traits.orders ? <span>{String(traits.orders)} orders</span> : null}
                {traits.revenue ? <span>{usd(num(traits.revenue))}</span> : null}
                {traits.aov ? <span>AOV {usd(num(traits.aov))}</span> : null}
                {geo.location ? <span>{String(geo.location)}</span> : null}
              </div>
              <div className="mt-3">
                <MiniSpark values={spark} tone={tier.tone === "hot" ? "gold" : tier.tone === "warm" ? "sage" : "muted"} width={120} height={22} />
              </div>
            </Link>
          );
        })}
      </div>
    </Shell>
  );
}
