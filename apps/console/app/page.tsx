"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getHealth } from "../src/api";
import { readSession } from "../src/session";
import type { Health, Session } from "../src/types";
import { EmptyState, ErrorState, Panel, Shell } from "../src/ui";

export default function DashboardPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setSession(readSession());
    getHealth().then(setHealth).catch((err: unknown) => setError(String(err)));
  }, []);

  return (
    <Shell>
      <div className="grid gap-5">
        <div>
          <p className="text-sm text-ink/60">US-only workspace</p>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
        </div>
        {!session ? <EmptyState title="No session" body="Sign up or paste an API token to manage a tenant." /> : null}
        {error ? <ErrorState message={error} /> : null}
        <div className="grid gap-4 md:grid-cols-4">
          {["received", "stored", "suppressed", "failed"].map((key) => (
            <Panel key={key}>
              <p className="text-sm capitalize text-ink/60">{key}</p>
              <p className="mt-2 text-3xl font-semibold">{health?.counters[key as keyof Health["counters"]] ?? "—"}</p>
            </Panel>
          ))}
        </div>
        <Panel>
          <h2 className="font-semibold">Tenant</h2>
          <p className="mt-2 text-sm text-ink/70">{session?.tenant?.name ?? session?.tenantId ?? "Not selected"}</p>
          <div className="mt-4 flex gap-2">
            <Link className="btn-secondary" href="/signup">Create tenant</Link>
            <Link className="btn-secondary" href="/login">Use token</Link>
          </div>
        </Panel>
      </div>
    </Shell>
  );
}
