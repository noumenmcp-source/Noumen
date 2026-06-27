"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { runJourney } from "../../../src/api";
import { readSession } from "../../../src/session";
import type { JourneyResult, Session } from "../../../src/types";
import { Badge, Button, EmptyState, ErrorState, Panel, Shell } from "../../../src/ui";

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
        <Panel className="flex items-center justify-between gap-3"><span>Preview: enter to action to exit</span><Button disabled={!session} onClick={() => void submit()}>Run</Button></Panel>
        {result ? <Panel><Badge tone={result.status === "completed" ? "ok" : "warm"}>{result.status}</Badge><div className="mt-3 grid gap-2 text-sm">{result.results.map((step) => <p key={step.key}>{step.key}: {step.status}</p>)}</div></Panel> : null}
      </div>
    </Shell>
  );
}
