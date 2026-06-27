"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getProfiles } from "../../src/api";
import { intentTier, intentValue } from "../../src/format";
import { readSession } from "../../src/session";
import type { Profile, Session } from "../../src/types";
import { Badge, EmptyState, ErrorState, PageHeader, Panel, Shell } from "../../src/ui";

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
        <PageHeader
          eyebrow="Customer graph"
          title="Profiles"
          body={profiles.length > 0 ? `${profiles.length} ranked by intent` : "Identity, firmographics, and activation priority for the current tenant."}
        />
        {!session ? <EmptyState title="No session" body="Sign in to load tenant profiles." /> : null}
        {loading ? <Panel>Loading profiles...</Panel> : null}
        {error ? <ErrorState message={error} /> : null}
        {!loading && session && !error && profiles.length === 0 ? (
          <EmptyState title="No profiles yet" body="Profiles appear here as events are ingested for this tenant." />
        ) : null}
        {profiles.length > 0 ? (
          <div className="table-shell overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="table-head">
                <tr>
                  <th className="px-4 py-3">Profile</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Industry</th>
                  <th className="px-4 py-3">Intent</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => {
                  const tier = intentTier(profile.intent.score);
                  return (
                    <tr className="table-row" key={profile.id}>
                      <td className="px-4 py-4">
                        <Link className="font-medium text-ink hover:text-accent" href={`/profiles/${profile.id}`}>
                          {profile.email ?? profile.anonymousId ?? profile.id}
                        </Link>
                        <p className="mt-1 max-w-xs truncate text-xs text-muted">{profile.id}</p>
                      </td>
                      <td className="px-4 py-4 text-muted">{profile.firmographics.company ?? "Unknown company"}</td>
                      <td className="px-4 py-4 text-muted">{profile.firmographics.industry ?? "-"}</td>
                      <td className="px-4 py-4"><Badge tone={tier.tone}>{tier.label}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </Shell>
  );
}
