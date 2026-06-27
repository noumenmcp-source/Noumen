"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readSession } from "../../../src/session";
import type { Session } from "../../../src/types";
import { Badge, EmptyState, Panel, Shell } from "../../../src/ui";

const destinations: readonly { readonly key: string; readonly label: string; readonly requiresConsent?: string }[] = [
  { key: "salesforce", label: "Salesforce", requiresConsent: "marketing_email" },
  { key: "hubspot", label: "HubSpot", requiresConsent: "marketing_email" },
  { key: "slack", label: "Slack" },
  { key: "webhook", label: "Webhook" },
] as const;

export default function DestinationsPage() {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => setSession(readSession()), []);

  return (
    <Shell>
      <div className="grid gap-5">
        <Link className="text-sm text-accent" href="/activation">Activation</Link>
        <h1 className="text-2xl font-semibold">Destinations</h1>
        {!session ? <EmptyState title="No session" body="Sign in to review tenant destinations." /> : null}
        <div className="grid gap-3 md:grid-cols-2">
          {destinations.map((item) => <Panel key={item.key}><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{item.label}</h2>{item.requiresConsent ? <Badge tone="warm">{item.requiresConsent}</Badge> : <Badge>operational</Badge>}</div><p className="mt-2 text-sm text-ink/70">Sync configuration is wired by the integrator for this destination.</p></Panel>)}
        </div>
      </div>
    </Shell>
  );
}
