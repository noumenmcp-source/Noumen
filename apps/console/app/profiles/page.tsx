"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getProfiles } from "../../src/api";
import { intentTier, intentValue } from "../../src/format";
import { readSession } from "../../src/session";
import type { Profile, Session } from "../../src/types";
import { Badge, EmptyState, ErrorState, Panel, Shell } from "../../src/ui";

export default function ProfilesPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [profiles, setProfiles] = useState<readonly Profile[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const current = readSession();
    setSession(current);
    if (!current) {
      setLoading(false);
      return;
    }
    getProfiles(current.tenantId, current.apiToken)
      .then((list) =>
        setProfiles(
          [...list].sort((a, b) => intentValue(b.intent.score) - intentValue(a.intent.score)),
        ),
      )
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Could not load profiles."),
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <Shell>
      <div className="grid gap-5">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold">Profiles</h1>
          {profiles.length > 0 ? (
            <span className="text-sm text-ink/60">{profiles.length} ranked by intent</span>
          ) : null}
        </div>
        {!session ? <EmptyState title="No session" body="Sign in to load tenant profiles." /> : null}
        {loading ? <Panel>Loading profiles…</Panel> : null}
        {error ? <ErrorState message={error} /> : null}
        {!loading && session && !error && profiles.length === 0 ? (
          <EmptyState title="No profiles yet" body="Profiles appear here as events are ingested for this tenant." />
        ) : null}
        <div className="grid gap-2">
          {profiles.map((profile) => {
            const tier = intentTier(profile.intent.score);
            return (
              <Link className="panel flex items-center justify-between gap-3 hover:border-accent" href={`/profiles/${profile.id}`} key={profile.id}>
                <div>
                  <p className="font-semibold">{profile.email ?? profile.anonymousId ?? profile.id}</p>
                  <p className="text-sm text-ink/70">
                    {profile.firmographics.company ?? "Unknown company"}
                    {profile.firmographics.industry ? ` · ${profile.firmographics.industry}` : ""}
                  </p>
                </div>
                <Badge tone={tier.tone}>{tier.label}</Badge>
              </Link>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}
