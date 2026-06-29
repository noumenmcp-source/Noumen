"use client";

import { useEffect, useState } from "react";
import { readSession } from "../../src/session";
import { EmptyState, ErrorState, Panel, Shell } from "../../src/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8110";

const STAGES = ["new", "active", "dormant", "lost", "vip", "junk"] as const;
type Stage = (typeof STAGES)[number];

const STAGE_DESC: Record<Stage, string> = {
  new: "Signed up, not yet converted",
  active: "Recently buying",
  dormant: "Quiet 90+ days",
  lost: "Long gone",
  vip: "Top repeat buyers",
  junk: "No buying signal",
};

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export default function LifecyclePage() {
  const [total, setTotal] = useState(0);
  const [stages, setStages] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const session = readSession();
    if (!session) {
      setError("Sign in to load lifecycle segments.");
      setLoading(false);
      return;
    }
    fetch(`${API_URL}/v1/tenants/${session.tenantId}/segments/lifecycle`, {
      headers: { authorization: `Bearer ${session.apiToken}` },
      cache: "no-store",
    })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) throw new Error("Forbidden — analyst role required.");
        if (!res.ok) throw new Error(`Request failed (HTTP ${res.status})`);
        const r = (await res.json()) as Record<string, unknown>;
        setTotal(num(r.total));
        setStages((typeof r.stages === "object" && r.stages !== null ? r.stages : {}) as Record<string, number>);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Shell>
      <div className="grid gap-5">
        <div>
          <h1 className="text-2xl font-semibold">Lifecycle segments</h1>
          <p className="mt-1 text-sm text-ink/70">Every profile auto-sorted into one stage (RFM-based).</p>
        </div>

        {error ? <ErrorState message={error} /> : null}
        {loading ? <p className="text-sm text-ink/60">Loading…</p> : null}

        {!loading && !error && total === 0 ? (
          <EmptyState title="No profiles" body="Import or collect profiles to see lifecycle stages." />
        ) : null}

        {total > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {STAGES.map((s) => {
              const n = num(stages[s]);
              const pct = total > 0 ? Math.round((n / total) * 100) : 0;
              return (
                <Panel key={s}>
                  <div className="flex items-baseline justify-between">
                    <h2 className="font-semibold capitalize">{s}</h2>
                    <span className="text-sm text-ink/60">{pct}%</span>
                  </div>
                  <p className="text-2xl font-semibold tabular-nums">{n.toLocaleString()}</p>
                  <p className="mt-1 text-sm text-ink/60">{STAGE_DESC[s]}</p>
                  <div className="mt-2 h-1.5 w-full rounded bg-field">
                    <div className="h-1.5 rounded bg-accent" style={{ width: `${Math.max(2, pct)}%` }} />
                  </div>
                </Panel>
              );
            })}
          </div>
        ) : null}
      </div>
    </Shell>
  );
}
