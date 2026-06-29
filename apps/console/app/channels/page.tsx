"use client";

import { useEffect, useState } from "react";
import { ChartCard, HBars, StatTile, type HBar, type Tone } from "../../src/charts";
import { EmptyState, ErrorState, Shell } from "../../src/ui";
import { readSession } from "../../src/session";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8110";

interface Channel {
  channel: string;
  profiles: number;
  customers: number;
  repeatCustomers: number;
  conversionRate: number;
  repeatRate: number;
  avgValue: number;
  neverClosedRate: number;
}

function convTone(r: number): Tone { return r >= 0.4 ? "sage" : r >= 0.25 ? "gold" : "rust"; }
function aovTone(v: number): Tone { return v >= 300 ? "gold" : v >= 150 ? "sage" : "muted"; }
function repeatTone(r: number): Tone { return r >= 0.5 ? "gold" : r >= 0.25 ? "sage" : "rust"; }

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const session = readSession();
    if (!session) { setError("Sign in first."); setLoading(false); return; }
    fetch(`${API_URL}/v1/tenants/${session.tenantId}/analytics/channel-quality`, {
      headers: { authorization: `Bearer ${session.apiToken}` }, cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const r = await res.json() as Record<string, unknown>;
        const list = Array.isArray(r.channels) ? r.channels as Channel[] : [];
        setChannels(list);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Shell><EmptyState title="Loading channels…" body="Aggregating acquisition data." /></Shell>;
  if (error) return <Shell><ErrorState message={error} /></Shell>;
  if (!channels.length) return <Shell><EmptyState title="No channels yet" body="Channels appear once profiles carry a first-touch source." /></Shell>;

  const best = [...channels].sort((a, b) => b.conversionRate - a.conversionRate)[0]!;
  const avgAov = Math.round(channels.reduce((s, c) => s + c.avgValue, 0) / channels.length);

  const convBars: HBar[] = [...channels]
    .sort((a, b) => b.conversionRate - a.conversionRate)
    .map((c) => ({
      label: c.channel,
      value: c.conversionRate * 100,
      tone: convTone(c.conversionRate),
      caption: `${c.profiles.toLocaleString()} leads · ${Math.round(c.conversionRate * 100)}% buy · ${Math.round(c.repeatRate * 100)}% return · $${Math.round(c.avgValue)} AOV`,
    }));

  const aovBars: HBar[] = [...channels]
    .sort((a, b) => b.avgValue - a.avgValue)
    .map((c) => ({
      label: c.channel,
      value: c.avgValue,
      tone: aovTone(c.avgValue),
      caption: `$${Math.round(c.avgValue)} avg · ${c.repeatCustomers.toLocaleString()} repeat buyers`,
    }));

  const repeatBars: HBar[] = [...channels]
    .sort((a, b) => b.repeatRate - a.repeatRate)
    .map((c) => ({
      label: c.channel,
      value: c.repeatRate * 100,
      tone: repeatTone(c.repeatRate),
      caption: `${c.repeatCustomers.toLocaleString()} of ${c.customers.toLocaleString()} bought again`,
    }));

  return (
    <Shell>
      <div className="mb-6">
        <p className="label text-muted">Acquisition channels</p>
        <h1 className="mt-1 font-serif text-3xl font-bold leading-tight text-ink">Who actually buys.</h1>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatTile label="Channels tracked" value={String(channels.length)} hint="first-touch attribution" tone="ink" />
        <StatTile label="Best converting" value={best.channel} hint={`${Math.round(best.conversionRate * 100)}% conversion`} tone="gold" />
        <StatTile label="Average AOV" value={`$${avgAov}`} hint="across all channels" tone="sage" />
      </div>

      <div className="grid gap-6">
        <ChartCard title="Conversion rate by channel" subtitle="Who brings buyers, not just clicks">
          <HBars bars={convBars} format={(v) => `${Math.round(v)}%`} />
        </ChartCard>

        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard title="Average order value" subtitle="Revenue quality per channel">
            <HBars bars={aovBars} format={(v) => `$${Math.round(v)}`} />
          </ChartCard>
          <ChartCard title="Repeat purchase rate" subtitle="Loyalty signal by acquisition source">
            <HBars bars={repeatBars} format={(v) => `${Math.round(v)}%`} />
          </ChartCard>
        </div>
      </div>
    </Shell>
  );
}
