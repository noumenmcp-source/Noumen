"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getHealth } from "../src/api";
import { readSession } from "../src/session";
import type { Health, Session } from "../src/types";
import { Badge, EmptyState, ErrorState, MetricCard, PageHeader, Panel, Shell } from "../src/ui";

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
        <PageHeader
          eyebrow="US-only workspace"
          title="Operations dashboard"
          body="Live intake, tenant state, and activation surfaces for the current customer account."
          actions={<Link className="btn-secondary" href="/modules">Manage modules</Link>}
        />
        {!session ? <EmptyState title="No session" body="Sign up or paste an API token to manage a tenant." /> : null}
        {error ? <ErrorState message={error} /> : null}
        <div className="grid gap-4 md:grid-cols-4">
          {counterCards.map((card) => (
            <MetricCard
              detail={card.detail}
              key={card.key}
              label={card.label}
              tone={card.tone}
              value={health?.counters[card.key] ?? "-"}
            />
          ))}
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <Panel>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-muted">Tenant</p>
                <h2 className="mt-1 text-xl font-medium">{session?.tenant?.name ?? session?.tenantId ?? "Not selected"}</h2>
              </div>
              <Badge tone={session ? "ok" : "neutral"}>{session ? "session" : "empty"}</Badge>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <TenantFact label="Tenant ID" value={session?.tenantId ?? "-"} />
              <TenantFact label="Region" value={session?.tenant?.region ?? health?.region ?? "-"} />
              <TenantFact label="Modules" value={String(session?.tenant?.enabledModules.length ?? 0)} />
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link className="btn-secondary" href="/signup">Create tenant</Link>
              <Link className="btn-secondary" href="/login">Use token</Link>
              <Link className="btn-secondary" href="/connect">Install connector</Link>
            </div>
          </Panel>
          <Panel>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-muted">API status</p>
                <h2 className="mt-1 text-xl font-medium">{health?.status ?? "unknown"}</h2>
              </div>
              <Badge tone={health?.status === "ok" ? "ok" : "warm"}>{health?.region ?? "us"}</Badge>
            </div>
            <div className="mt-5 grid gap-2 text-sm">
              <Link className="rounded-lg border border-line px-3 py-2 hover:bg-field" href="/profiles">Profiles</Link>
              <Link className="rounded-lg border border-line px-3 py-2 hover:bg-field" href="/activation">Activation</Link>
              <Link className="rounded-lg border border-line px-3 py-2 hover:bg-field" href="/modules">Module control</Link>
            </div>
          </Panel>
        </div>
      </div>
    </Shell>
  );
}

function TenantFact(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-lg border border-line bg-field/60 p-3">
      <p className="text-xs font-medium uppercase text-muted">{props.label}</p>
      <p className="mt-1 truncate text-sm font-medium">{props.value}</p>
    </div>
  );
}

const counterCards: readonly {
  readonly key: keyof Health["counters"];
  readonly label: string;
  readonly detail: string;
  readonly tone: "neutral" | "ok" | "warm" | "hot" | "info";
}[] = [
  { key: "received", label: "Received", detail: "Accepted by track API", tone: "info" },
  { key: "stored", label: "Stored", detail: "Persisted events", tone: "ok" },
  { key: "suppressed", label: "Suppressed", detail: "Compliance gated", tone: "warm" },
  { key: "failed", label: "Failed", detail: "Rejected or errored", tone: "hot" },
];
