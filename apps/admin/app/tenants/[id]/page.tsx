"use client";

import { use } from "react";
import { useEffect, useState } from "react";
import { listTenantEvents, listTenantProfiles } from "../../../src/api";
import { readAdminToken } from "../../../src/session";
import type { Profile, TenantEvent } from "../../../src/types";
import { EmptyState, ErrorState, Shell } from "../../../src/ui";

export default function TenantDetailPage(props: { readonly params: Promise<{ readonly id: string }> }) {
  const tenantId = use(props.params).id;
  const [profiles, setProfiles] = useState<readonly Profile[]>([]);
  const [events, setEvents] = useState<readonly TenantEvent[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = readAdminToken();
    Promise.all([listTenantProfiles(tenantId, token), listTenantEvents(tenantId, token)])
      .then(([profileList, eventList]) => {
        setProfiles(profileList);
        setEvents(eventList);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load tenant details."))
      .finally(() => setLoading(false));
  }, [tenantId]);

  return (
    <Shell>
      <div className="grid gap-5">
        <div>
          <h1 className="text-2xl font-semibold">Tenant {tenantId}</h1>
          <p className="text-sm text-ink/70">Read-only support view for profiles and events.</p>
        </div>
        {loading ? <section className="panel">Loading tenant details...</section> : null}
        {error ? <ErrorState message={error} /> : null}
        <section className="grid gap-3 md:grid-cols-3">
          <Metric label="Profiles" value={profiles.length} />
          <Metric label="Events" value={events.length} />
          <Metric label="Usage limits" value="Planned" />
        </section>
        {!loading && !error && profiles.length === 0 ? (
          <EmptyState title="No profiles" body="Profiles appear after tenant events are ingested." />
        ) : null}
        <section className="panel">
          <h2 className="font-semibold">Profiles</h2>
          <div className="mt-3 grid gap-2">
            {profiles.slice(0, 20).map((profile) => (
              <div className="rounded-md border border-line p-3" key={profile.id}>
                <p className="font-medium">{profile.email ?? profile.userId ?? profile.anonymousId ?? profile.id}</p>
                <p className="text-sm text-ink/70">{profile.firmographics?.company ?? "Unknown company"}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <h2 className="font-semibold">Recent events</h2>
          <div className="mt-3 grid gap-2">
            {events.slice(0, 20).map((event, index) => (
              <div className="rounded-md border border-line p-3" key={`${event.anonymousId}-${event.ts ?? index}`}>
                <p className="font-medium">{event.event ?? event.type}</p>
                <p className="text-sm text-ink/70">{event.anonymousId}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Shell>
  );
}

function Metric(props: { readonly label: string; readonly value: string | number }) {
  return (
    <div className="panel">
      <p className="text-sm text-ink/60">{props.label}</p>
      <p className="mt-1 text-2xl font-semibold">{props.value}</p>
    </div>
  );
}
