"use client";

import { useEffect, useState } from "react";
import { readSession } from "../../src/session";
import type { Session } from "../../src/types";
import { StatTile } from "../../src/charts";
import { Badge, Button, EmptyState, ErrorState, Panel, Shell } from "../../src/ui";

interface UsageRow {
  metric: string;
  used: number;
  limit: number | null; // null = unlimited
}
interface Billing {
  plan: string;
  status: string;
  entitledModules: string[];
  enabledModules: string[];
  usage: UsageRow[];
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8110";

const METRIC_LABEL: Record<string, string> = {
  eventsPerMonth: "Events / month",
  emailsPerMonth: "Emails / month",
  seats: "Seats",
};

function pct(used: number, limit: number | null): number {
  if (limit === null || limit <= 0) return 0;
  return Math.min(100, (used / limit) * 100);
}

export default function BillingPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [data, setData] = useState<Billing | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setSession(readSession()), []);

  useEffect(() => {
    if (!session?.tenantId) return;
    fetch(`${API_URL}/v1/tenants/${session.tenantId}/billing`, {
      headers: { authorization: `Bearer ${session.apiToken}` },
    })
      .then((r) => {
        if (r.status === 403) throw new Error("Admin role required to view billing.");
        if (!r.ok) throw new Error(`Request failed (HTTP ${r.status})`);
        return r.json();
      })
      .then((d) => setData(d))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load billing."));
  }, [session]);

  return (
    <Shell>
      <div className="space-y-6 p-4">
        <div>
          <p className="label">Account</p>
          <h1 className="font-serif text-3xl font-bold text-ink">Plan &amp; usage.</h1>
        </div>

        {error ? <ErrorState message={error} /> : null}
        {!error && !data ? <EmptyState title="Loading…" body="Fetching your plan and usage." /> : null}

        {data ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatTile label="Plan" value={data.plan} tone="gold" />
              <StatTile label="Status" value={data.status} tone={data.status === "active" ? "sage" : "rust"} />
              <StatTile label="Modules enabled" value={`${data.enabledModules.length}/${data.entitledModules.length}`} tone="ink" />
            </div>

            <Panel>
              <h2 className="font-serif text-lg font-bold text-ink">Usage this month</h2>
              <div className="mt-4 grid gap-4">
                {data.usage.map((u) => (
                  <div key={u.metric}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium text-ink">{METRIC_LABEL[u.metric] ?? u.metric}</span>
                      <span className="font-mono text-xs text-muted">
                        {u.used.toLocaleString()} / {u.limit === null ? "∞" : u.limit.toLocaleString()}
                      </span>
                    </div>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded bg-cream">
                      <span
                        className="block h-2 rounded"
                        style={{ width: `${pct(u.used, u.limit)}%`, background: pct(u.used, u.limit) > 85 ? "#c4683a" : "#c9a84c" }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel>
              <h2 className="font-serif text-lg font-bold text-ink">Modules</h2>
              <p className="mt-1 text-sm text-muted">Entitled by the {data.plan} plan; enabled for this tenant.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {data.entitledModules.map((m) => (
                  <Badge key={m} tone={data.enabledModules.includes(m) ? "ok" : "muted"}>
                    {m}{data.enabledModules.includes(m) ? "" : " · off"}
                  </Badge>
                ))}
              </div>
            </Panel>

            <Panel>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-serif text-lg font-bold text-ink">Manage billing</h2>
                  <p className="mt-1 text-sm text-muted">Self-serve upgrades and payment run through Stripe — not yet connected.</p>
                </div>
                <Button disabled>Manage billing (soon)</Button>
              </div>
            </Panel>
          </>
        ) : null}
      </div>
    </Shell>
  );
}
