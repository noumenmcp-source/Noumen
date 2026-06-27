"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getEvents, getProfiles } from "../../../src/api";
import { formatTs, intentTier } from "../../../src/format";
import { readSession } from "../../../src/session";
import type { Profile, Session, TimelineEvent } from "../../../src/types";
import { Badge, EmptyState, ErrorState, Panel, Shell } from "../../../src/ui";

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
    loadProfile(current, profileId)
      .then(setProfile)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Could not load profile."),
      );
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
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">{profile?.email ?? profile?.anonymousId ?? profileId}</p>
              <p className="mt-1 text-sm text-ink/70">
                {profile?.firmographics.company ?? "No firmographics yet"}
                {profile?.firmographics.industry ? ` · ${profile.firmographics.industry}` : ""}
                {profile?.firmographics.domain ? ` · ${profile.firmographics.domain}` : ""}
              </p>
            </div>
            {profile ? (() => {
              const tier = intentTier(profile.intent.score);
              return <Badge tone={tier.tone}>{tier.label}</Badge>;
            })() : null}
          </div>
          {profile?.intent.lastActiveAt ? (
            <p className="mt-2 text-xs text-ink/60">Last active {formatTs(profile.intent.lastActiveAt)}</p>
          ) : null}
        </Panel>
        {session && !error && events.length === 0 ? (
          <EmptyState title="No events yet" body="Timeline events appear here as this profile is active." />
        ) : null}
        {events.map((event) => {
          const propKeys = Object.keys(event.properties);
          return (
            <Panel key={event.id}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-semibold">{event.name ?? event.type}</p>
                <p className="text-sm text-ink/60">{formatTs(event.ts)}</p>
              </div>
              {propKeys.length > 0 ? (
                <p className="mt-1 text-xs text-ink/60">{propKeys.slice(0, 6).join(", ")}</p>
              ) : null}
            </Panel>
          );
        })}
      </div>
    </Shell>
  );
}

async function loadProfile(session: Session, id: string): Promise<Profile | null> {
  const profiles = await getProfiles(session.tenantId, session.apiToken);
  return profiles.find((item) => item.id === id) ?? null;
}
