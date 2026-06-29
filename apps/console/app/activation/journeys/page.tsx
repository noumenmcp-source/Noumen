"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { runJourney } from "../../../src/api";
import { readSession } from "../../../src/session";
import type { JourneyResult, Session } from "../../../src/types";
import { Badge, Button, EmptyState, ErrorState, Panel, Shell } from "../../../src/ui";
import { StatTile } from "../../../src/charts";

const definition = {
  key: "activation-preview",
  steps: [
    { key: "enter", type: "enter", when: { path: "profile.traits.plan", equals: "pro" }, next: "action" },
    { key: "action", type: "action", executor: "preview", params: { channel: "email" }, next: "exit" },
    { key: "exit", type: "exit" },
  ],
};

export default function JourneysPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [result, setResult] = useState<JourneyResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => setSession(readSession()), []);

  async function submit() {
    if (!session) return;
    setError("");
    try {
      setResult(await runJourney(session.tenantId, session.apiToken, definition));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Journey run failed.");
    }
  }

  return (
    <Shell>
      <div className="grid gap-5">
        <Link className="text-sm text-accent" href="/activation">Activation</Link>
        <h1 className="text-2xl font-semibold">Journeys</h1>
        {!session ? <EmptyState title="No session" body="Sign in to run journey previews." /> : null}
        {error ? <ErrorState message={error} /> : null}
        <Panel className="flex items-center justify-between gap-3"><span>Preview: enter → action → exit</span><Button disabled={!session} onClick={() => void submit()}>Run</Button></Panel>
        {result ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatTile
                label="Outcome"
                value={result.status}
                tone={result.status === "completed" ? "sage" : result.status === "rejected" ? "rust" : "gold"}
              />
              <StatTile label="Steps run" value={result.results.length.toLocaleString()} tone="ink" />
              <StatTile
                label="Completed steps"
                value={result.results.filter((s) => s.status === "completed" || s.status === "ok").length.toLocaleString()}
                tone="muted"
              />
            </div>
            <Panel>
              <h2 className="font-semibold">Step trace</h2>
              <ol className="mt-3 grid gap-1 text-sm">
                {result.results.map((step) => (
                  <li key={step.key} className="flex items-center justify-between rounded border border-line px-3 py-2">
                    <span className="font-mono text-xs text-ink/80">{step.key} <span className="text-ink/40">· {step.type}</span></span>
                    <Badge tone={step.status === "completed" || step.status === "ok" ? "ok" : "warm"}>{step.status}</Badge>
                  </li>
                ))}
              </ol>
            </Panel>
          </>
        ) : null}
      </div>
    </Shell>
  );
}
