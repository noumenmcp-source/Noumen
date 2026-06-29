"use client";

import { useEffect, useState } from "react";
import { readSession } from "../../src/session";
import { EmptyState, ErrorState, Panel, Shell } from "../../src/ui";

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

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function asChannel(v: unknown): Channel | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (!str(r.channel)) return null;
  return {
    channel: str(r.channel),
    profiles: num(r.profiles),
    customers: num(r.customers),
    repeatCustomers: num(r.repeatCustomers),
    conversionRate: num(r.conversionRate),
    repeatRate: num(r.repeatRate),
    avgValue: num(r.avgValue),
    neverClosedRate: num(r.neverClosedRate),
  };
}

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const session = readSession();
    if (!session) {
      setError("Sign in to load channel quality.");
      setLoading(false);
      return;
    }
    fetch(`${API_URL}/v1/tenants/${session.tenantId}/analytics/channel-quality`, {
      headers: { authorization: `Bearer ${session.apiToken}` },
      cache: "no-store",
    })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) throw new Error("Forbidden — analyst role required.");
        if (!res.ok) throw new Error(`Request failed (HTTP ${res.status})`);
        const r = (await res.json()) as Record<string, unknown>;
        const list = Array.isArray(r.channels)
          ? r.channels.map(asChannel).filter((c): c is Channel => c !== null)
          : [];
        list.sort((a, b) => b.conversionRate - a.conversionRate);
        setChannels(list);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Shell>
      <div className="grid gap-5">
        <div>
          <h1 className="text-2xl font-semibold">Channel quality</h1>
          <p className="mt-1 text-sm text-ink/70">
            First-touch channel by outcome — which sources bring buyers, not just clicks.
          </p>
        </div>

        {error ? <ErrorState message={error} /> : null}
        {loading ? <p className="text-sm text-ink/60">Loading…</p> : null}

        {!loading && !error && channels.length === 0 ? (
          <EmptyState title="No channel data" body="Channels appear once profiles carry a first-touch source." />
        ) : null}

        {channels.length > 0 ? (
          <Panel>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-ink/60">
                    <th className="py-2 pr-4 font-medium">Channel</th>
                    <th className="py-2 pr-4 font-medium text-right">Profiles</th>
                    <th className="py-2 pr-4 font-medium text-right">Customers</th>
                    <th className="py-2 pr-4 font-medium text-right">Conv.</th>
                    <th className="py-2 pr-4 font-medium text-right">Repeat</th>
                    <th className="py-2 pr-4 font-medium text-right">Avg value</th>
                    <th className="py-2 font-medium text-right">Never closed</th>
                  </tr>
                </thead>
                <tbody>
                  {channels.map((c) => (
                    <tr key={c.channel} className="border-b border-line last:border-0">
                      <td className="py-2 pr-4 font-medium">{c.channel}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{c.profiles.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{c.customers.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{pct(c.conversionRate)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{pct(c.repeatRate)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{c.avgValue.toLocaleString()}</td>
                      <td className="py-2 text-right tabular-nums">{pct(c.neverClosedRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ) : null}
      </div>
    </Shell>
  );
}
