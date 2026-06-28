"use client";

import { useEffect, useState } from "react";
import { readSession } from "../../src/session";
import { Badge, EmptyState, ErrorState, Panel, Shell } from "../../src/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8110";

interface Action {
  key: string;
  title: string;
  channel: string;
  audienceSize: number;
  impact: number;
  rationale: string;
  copyValid: boolean | null;
  copy: { subject?: string; body: string } | null;
}
interface Channel {
  channel: string;
  profiles: number;
  conversionRate: number;
  repeatRate: number;
  avgValue: number;
  neverClosedRate: number;
}
interface Audit {
  total: number;
  stages: Record<string, number>;
  channels: Channel[];
  actions: Action[];
}

const STAGE_ORDER = ["vip", "active", "dormant", "lost", "new", "junk"] as const;
const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function TodayPage() {
  const [audit, setAudit] = useState<Audit | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const session = readSession();
    if (!session) {
      setError("Sign in first.");
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`${API_URL}/v1/tenants/${session.tenantId}/report/base-audit`, {
          headers: { authorization: `Bearer ${session.apiToken}` },
          cache: "no-store",
        });
        if (res.status === 401) return setError("Unauthorized. Please sign in again.");
        if (res.status === 403) return setError("Forbidden: needs analyst/admin role.");
        if (!res.ok) return setError(`Request failed (HTTP ${res.status})`);
        const data = (await res.json()) as Record<string, unknown>;
        const base = (data.base ?? {}) as Record<string, unknown>;
        setAudit({
          total: typeof base.total === "number" ? base.total : 0,
          stages: (base.stages ?? {}) as Record<string, number>,
          channels: Array.isArray(data.channels) ? (data.channels as Channel[]) : [],
          actions: Array.isArray(data.playbook) ? (data.playbook as Action[]) : [],
        });
      } catch {
        setError("Network error.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <Shell>
      <div className="grid gap-5">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold">Today in your base</h1>
          {audit ? <Badge tone="ok">{audit.actions.length} actions</Badge> : null}
        </div>
        <p className="text-sm text-ink/60">Money, not metrics — who to win back, which channel brings junk, what to do today.</p>

        {error ? <ErrorState message={error} /> : null}
        {loading ? <EmptyState title="Loading your base…" body="Reading profiles and events." /> : null}

        {audit ? (
          <>
            <Panel>
              <h2 className="mb-3 text-lg font-medium">Your base — {audit.total} profiles</h2>
              <div className="flex flex-wrap gap-2">
                {STAGE_ORDER.filter((s) => (audit.stages[s] ?? 0) >= 0).map((s) => (
                  <span key={s} className="rounded-md border border-line px-3 py-1 text-sm">
                    <span className="text-ink/60">{s}</span> · <b>{audit.stages[s] ?? 0}</b>
                  </span>
                ))}
              </div>
            </Panel>

            <Panel>
              <h2 className="mb-3 text-lg font-medium">What will make money this week</h2>
              {audit.actions.length === 0 ? (
                <EmptyState title="Nothing to do yet" body="Connect a source so we can find money in your base." />
              ) : (
                <div className="grid gap-3">
                  {audit.actions.map((a) => (
                    <div key={a.key} className="rounded-md border border-line p-3">
                      <div className="flex items-center justify-between">
                        <b>{a.title}</b>
                        <span className="flex items-center gap-2">
                          <Badge>{a.channel}</Badge>
                          <span className="text-sm text-ink/60">{a.audienceSize} people</span>
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-ink/60">{a.rationale}</p>
                      {a.copy ? (
                        <div className="mt-2 rounded bg-field p-2 text-xs">
                          {a.copy.subject ? <div className="font-medium">{a.copy.subject}</div> : null}
                          <div className="whitespace-pre-wrap text-ink/70">{a.copy.body}</div>
                          <div className="mt-1">
                            <Badge tone={a.copyValid ? "ok" : "warm"}>{a.copyValid ? "copy ready" : "needs review"}</Badge>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel>
              <h2 className="mb-3 text-lg font-medium">Channel quality</h2>
              {audit.channels.length === 0 ? (
                <EmptyState title="No channel data" body="We need first-touch source on your events." />
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-ink/60">
                      <th className="py-2">Channel</th>
                      <th className="py-2">Profiles</th>
                      <th className="py-2">Converts</th>
                      <th className="py-2">Repeat</th>
                      <th className="py-2">AOV</th>
                      <th className="py-2">Never closed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.channels.map((c) => (
                      <tr key={c.channel} className="border-b border-line">
                        <td className="py-2 font-medium">{c.channel}</td>
                        <td className="py-2">{c.profiles}</td>
                        <td className="py-2">{pct(c.conversionRate)}</td>
                        <td className="py-2">{pct(c.repeatRate)}</td>
                        <td className="py-2">{c.avgValue}</td>
                        <td className="py-2">{pct(c.neverClosedRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          </>
        ) : null}
      </div>
    </Shell>
  );
}
