"use client";

import Link from "next/link";
import { useState } from "react";
import { querySegment, type SegmentPredicate } from "../../src/api";
import { readSession } from "../../src/session";
import type { Profile } from "../../src/types";
import { EmptyState, ErrorState, Panel, Shell } from "../../src/ui";

const FIELDS = [
  "firmographics.company",
  "firmographics.industry",
  "firmographics.country",
  "email",
] as const;

export default function SegmentsPage() {
  const [path, setPath] = useState<string>(FIELDS[0]);
  const [value, setValue] = useState("");
  const [members, setMembers] = useState<readonly Profile[]>([]);
  const [error, setError] = useState("");
  const [ran, setRan] = useState(false);
  const [loading, setLoading] = useState(false);

  async function run() {
    const session = readSession();
    if (!session) {
      setError("Sign in to query segments.");
      return;
    }
    const predicate: SegmentPredicate = value
      ? { path, equals: value }
      : { path, exists: true };
    setLoading(true);
    setError("");
    try {
      setMembers(await querySegment(session.tenantId, session.apiToken, [predicate]));
      setRan(true);
    } catch {
      setError("Segment query is not available.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Shell>
      <div className="grid gap-5">
        <h1 className="text-2xl font-semibold">Segments</h1>
        <Panel>
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="grid gap-1 text-sm">
              Field
              <select
                className="rounded border border-ink/20 bg-transparent p-2"
                value={path}
                onChange={(e) => setPath(e.target.value)}
              >
                {FIELDS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Equals (blank = exists)
              <input
                className="rounded border border-ink/20 bg-transparent p-2"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="e.g. Acme"
              />
            </label>
            <button
              className="rounded bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50"
              onClick={run}
              disabled={loading}
            >
              {loading ? "Running…" : "Run query"}
            </button>
          </div>
        </Panel>

        {error ? <ErrorState message={error} /> : null}
        {ran && !loading && members.length === 0 ? (
          <EmptyState title="No matches" body="No profiles matched this rule." />
        ) : null}
        {members.length > 0 ? (
          <p className="text-sm text-ink/70">{members.length} matching profiles</p>
        ) : null}
        <div className="grid gap-2">
          {members.map((profile) => (
            <Link
              className="panel hover:border-accent"
              href={`/profiles/${profile.id}`}
              key={profile.id}
            >
              <p className="font-semibold">
                {profile.email ?? profile.anonymousId ?? profile.id}
              </p>
              <p className="text-sm text-ink/70">
                {profile.firmographics.company ?? "Unknown company"}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </Shell>
  );
}
