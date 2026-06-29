"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { analyticsFunnel, analyticsRetention } from "../../../src/api";
import { readSession } from "../../../src/session";
import type { FunnelStep, RetentionPoint, Session } from "../../../src/types";
import { Button, EmptyState, ErrorState, Panel, Shell } from "../../../src/ui";
import { AreaTrend, ChartCard, StatTile, VBars } from "../../../src/charts";

export default function AnalyticsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [steps, setSteps] = useState<readonly FunnelStep[]>([]);
  const [retention, setRetention] = useState<readonly RetentionPoint[]>([]);
  const [error, setError] = useState("");

  useEffect(() => setSession(readSession()), []);

  async function load() {
    if (!session) return;
    setError("");
    try {
      const [funnel, retained] = await Promise.all([
        analyticsFunnel(session.tenantId, session.apiToken, ["Signup", "Activated", "Paid"]),
        analyticsRetention(session.tenantId, session.apiToken, { cohortDay: "2026-06-01", windowDays: 7, now: "2026-06-08" }),
      ]);
      setSteps(funnel);
      setRetention(retained);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analytics load failed.");
    }
  }

  return (
    <Shell>
      <div className="grid gap-5">
        <Link className="text-sm text-accent" href="/activation">Activation</Link>
        <div className="flex items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Analytics</h1><Button disabled={!session} onClick={() => void load()}>Load</Button></div>
        {!session ? <EmptyState title="No session" body="Sign in to load tenant analytics." /> : null}
        {error ? <ErrorState message={error} /> : null}

        {steps.length > 0 || retention.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <StatTile label="Entered" value={(steps[0]?.count ?? 0).toLocaleString()} tone="ink" />
            <StatTile
              label="Funnel conversion"
              value={steps.length > 0 && (steps[0]?.count ?? 0) > 0
                ? `${(((steps[steps.length - 1]?.count ?? 0) / steps[0]!.count) * 100).toFixed(1)}%`
                : "—"}
              tone="gold"
            />
            <StatTile
              label="Latest retention"
              value={retention.length > 0 ? `${((retention[retention.length - 1]?.rate ?? 0) * 100).toFixed(1)}%` : "—"}
              tone="sage"
            />
          </div>
        ) : null}

        {steps.length > 0 ? (
          <ChartCard title="Funnel" subtitle="Profiles reaching each step">
            <VBars
              bars={steps.map((s) => ({ label: s.step, value: s.count }))}
              tone="gold"
              height={170}
              format={(v) => v.toLocaleString()}
            />
          </ChartCard>
        ) : (
          <Panel><h2 className="font-semibold">Funnel</h2><p className="mt-2 text-sm text-ink/60">Load to see funnel steps.</p></Panel>
        )}

        {retention.length >= 2 ? (
          <ChartCard title="Retention" subtitle="Daily retention over the window">
            <AreaTrend
              points={retention.map((p) => ({ x: `D${p.day}`, y: p.rate * 100 }))}
              tone="sage"
              format={(v) => `${v.toFixed(0)}%`}
            />
          </ChartCard>
        ) : retention.length > 0 ? (
          <Panel><h2 className="font-semibold">Retention</h2><div className="mt-3 grid gap-2 text-sm">{retention.map((point) => <p key={point.day}>Day {point.day}: {(point.rate * 100).toFixed(1)}%</p>)}</div></Panel>
        ) : (
          <Panel><h2 className="font-semibold">Retention</h2><p className="mt-2 text-sm text-ink/60">Load to see retention curve.</p></Panel>
        )}
      </div>
    </Shell>
  );
}
