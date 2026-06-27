"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getProfiles } from "../../src/api";
import { readSession } from "../../src/session";
import type { Profile, Session } from "../../src/types";
import { EmptyState, ErrorState, Panel, Shell } from "../../src/ui";

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
      .then(setProfiles)
      .catch(() => setError("Profiles API is not available yet."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Shell>
      <div className="grid gap-5">
        <h1 className="text-2xl font-semibold">Profiles</h1>
        {!session ? <EmptyState title="No session" body="Sign in to load tenant profiles." /> : null}
        {loading ? <Panel>Loading profiles…</Panel> : null}
        {error ? <ErrorState message={error} /> : null}
        {!loading && profiles.length === 0 ? <EmptyState title="No profiles" body="Profiles will appear after CDP identity is wired." /> : null}
        <div className="grid gap-2">
          {profiles.map((profile) => (
            <Link className="panel hover:border-accent" href={`/profiles/${profile.id}`} key={profile.id}>
              <p className="font-semibold">{profile.email ?? profile.anonymousId ?? profile.id}</p>
              <p className="text-sm text-ink/70">{profile.firmographics.company ?? "Unknown company"}</p>
            </Link>
          ))}
        </div>
      </div>
    </Shell>
  );
}
