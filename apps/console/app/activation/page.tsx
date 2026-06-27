"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readSession } from "../../src/session";
import type { Session } from "../../src/types";
import { EmptyState, Panel, Shell } from "../../src/ui";

const cards = [
  { href: "/activation/audiences", title: "Audiences", body: "Evaluate rules and inspect member samples." },
  { href: "/activation/journeys", title: "Journeys", body: "Run a deterministic journey preview." },
  { href: "/activation/destinations", title: "Destinations", body: "Review supported reverse-ETL activation targets." },
  { href: "/activation/analytics", title: "Analytics", body: "Read funnel and retention activation signals." },
] as const;

export default function ActivationPage() {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => setSession(readSession()), []);

  return (
    <Shell>
      <div className="grid gap-5">
        <div>
          <h1 className="text-2xl font-semibold">Activation</h1>
          <p className="mt-1 text-sm text-ink/70">Audience, journey, destination, and analytics controls for tenant activation.</p>
        </div>
        {!session ? <EmptyState title="No session" body="Sign in to load tenant activation." /> : null}
        <div className="grid gap-3 md:grid-cols-2">
          {cards.map((card) => (
            <Link className="panel hover:border-accent" href={card.href} key={card.href}>
              <h2 className="font-semibold">{card.title}</h2>
              <p className="mt-1 text-sm text-ink/70">{card.body}</p>
            </Link>
          ))}
        </div>
        {session ? <Panel>Tenant: {session.tenant?.name ?? session.tenantId}</Panel> : null}
      </div>
    </Shell>
  );
}
