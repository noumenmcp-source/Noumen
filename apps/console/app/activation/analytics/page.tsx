"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { analyticsFunnel, analyticsRetention } from "../../../src/api";
import { readSession } from "../../../src/session";
import type { FunnelStep, RetentionPoint, Session } from "../../../src/types";
import { Button, EmptyState, ErrorState, Panel, Shell } from "../../../src/ui";

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
        <Panel><h2 className="font-semibold">Funnel</h2><div className="mt-3 grid gap-2 text-sm">{steps.map((step) => <p key={step.step}>{step.step}: {step.count} reached, {step.dropoff} dropoff</p>)}</div></Panel>
        <Panel><h2 className="font-semibold">Retention</h2><div className="mt-3 grid gap-2 text-sm">{retention.map((point) => <p key={point.day}>Day {point.day}: {(point.rate * 100).toFixed(1)}%</p>)}</div></Panel>
      </div>
    </Shell>
  );
}
