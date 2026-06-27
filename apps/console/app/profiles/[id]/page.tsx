"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getEvents, getProfiles } from "../../../src/api";
import { readSession } from "../../../src/session";
import type { Profile, Session, TimelineEvent } from "../../../src/types";
import { EmptyState, ErrorState, Panel, Shell } from "../../../src/ui";

export default function ProfileDetailPage() {
  const params = useParams<{ readonly id: string }>();
  const profileId = params.id;
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [events, setEvents] = useState<readonly TimelineEvent[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const current = readSession();
    setSession(current);
    if (!current) return;
    loadProfile(current, profileId).then(setProfile).catch(() => setError("Profile API is not available yet."));
  }, [profileId]);

  useEffect(() => {
    if (!session || !profile?.anonymousId) return;
    getEvents(session.tenantId, session.apiToken, profile.anonymousId)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [profile, session]);

  return (
    <Shell>
      <div className="grid gap-5">
        <h1 className="text-2xl font-semibold">Profile timeline</h1>
        {error ? <ErrorState message={error} /> : null}
        {!session ? <EmptyState title="No session" body="Sign in to inspect profiles." /> : null}
        <Panel>
          <p className="font-semibold">{profile?.email ?? profile?.anonymousId ?? profileId}</p>
          <p className="mt-1 text-sm text-ink/70">{profile?.firmographics.company ?? "No firmographics yet"}</p>
        </Panel>
        {events.length === 0 ? <EmptyState title="No events" body="Timeline events will appear when the read endpoint is available." /> : null}
        {events.map((event) => (
          <Panel key={event.id}>
            <p className="font-semibold">{event.name ?? event.type}</p>
            <p className="text-sm text-ink/60">{event.ts || "No timestamp"}</p>
          </Panel>
        ))}
      </div>
    </Shell>
  );
}

async function loadProfile(session: Session, id: string): Promise<Profile | null> {
  const profiles = await getProfiles(session.tenantId, session.apiToken);
  return profiles.find((item) => item.id === id) ?? null;
}
