"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { evaluateAudience } from "../../../src/api";
import { readSession } from "../../../src/session";
import type { AudienceResult, Session } from "../../../src/types";
import { Button, EmptyState, ErrorState, Field, Panel, Shell } from "../../../src/ui";
import { StatTile } from "../../../src/charts";

export default function AudiencesPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [path, setPath] = useState("traits.plan");
  const [equals, setEquals] = useState("pro");
  const [result, setResult] = useState<AudienceResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => setSession(readSession()), []);

  async function submit() {
    if (!session) return;
    setError("");
    try {
      setResult(await evaluateAudience(session.tenantId, session.apiToken, { name: "Activation Segment", sampleSize: 10, rule: [{ path, equals }] }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Audience evaluation failed.");
    }
  }

  return (
    <Shell>
      <div className="grid gap-5">
        <Link className="text-sm text-accent" href="/activation">Activation</Link>
        <h1 className="text-2xl font-semibold">Audiences</h1>
        {!session ? <EmptyState title="No session" body="Sign in to evaluate tenant audiences." /> : null}
        {error ? <ErrorState message={error} /> : null}
        <Panel className="grid gap-3">
          <Field label="Trait path" value={path} onChange={setPath} />
          <Field label="Equals" value={equals} onChange={setEquals} />
          <Button disabled={!session} onClick={() => void submit()}>Evaluate</Button>
        </Panel>
        {result ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatTile label="Audience size" value={result.size.toLocaleString()} tone="gold" />
              <StatTile label="Sample shown" value={result.sampleIds.length.toLocaleString()} tone="ink" />
              {result.overlap ? (
                <StatTile label="In both segments" value={result.overlap.both.toLocaleString()} tone="sage" />
              ) : null}
            </div>
            <Panel>
              <h2 className="font-semibold">Sample members</h2>
              {result.sampleIds.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {result.sampleIds.map((id) => (
                    <span key={id} className="rounded border border-line bg-field px-2 py-0.5 font-mono text-xs text-ink/80">{id}</span>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-sm text-ink/60">No members matched this rule.</p>
              )}
            </Panel>
          </>
        ) : null}
      </div>
    </Shell>
  );
}
