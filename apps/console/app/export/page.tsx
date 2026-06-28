"use client";

import { useState } from "react";
import { readSession } from "../../src/session";
import { Button, EmptyState, ErrorState, Panel, Shell } from "../../src/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8110";

interface ExportStats {
  lines: number;
  profiles: number;
  events: number;
}

function parseNdjson(text: string): ExportStats {
  const lines = text.trim().split("\n").filter(Boolean);
  let profiles = 0;
  let events = 0;
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as { _type?: string };
      if (row._type === "profile") profiles++;
      else if (row._type === "event") events++;
    } catch {
      // skip malformed
    }
  }
  return { lines: lines.length, profiles, events };
}

async function downloadExport(
  tenantId: string,
  token: string,
): Promise<{ text: string; stats: ExportStats }> {
  const res = await fetch(`${API_URL}/v1/tenants/${tenantId}/export`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  return { text, stats: parseNdjson(text) };
}

export default function ExportPage() {
  const [stats, setStats] = useState<ExportStats | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [blob, setBlob] = useState<string | null>(null);

  async function run() {
    const session = readSession();
    if (!session) { setError("Sign in first."); return; }
    setLoading(true);
    setError("");
    setStats(null);
    setBlob(null);
    try {
      const { text, stats: s } = await downloadExport(session.tenantId, session.apiToken);
      setStats(s);
      // Create downloadable blob URL
      const b = new Blob([text], { type: "application/x-ndjson" });
      setBlob(URL.createObjectURL(b));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Shell>
      <div className="grid gap-5">
        <h1 className="text-2xl font-semibold">Data Export</h1>
        <p className="text-sm text-ink/60">
          Download all your tenant data as NDJSON (one record per line).
          Each line has a <code className="rounded bg-field px-1 font-mono text-xs">_type</code> field:
          {" "}<code className="rounded bg-field px-1 font-mono text-xs">meta</code> ·{" "}
          <code className="rounded bg-field px-1 font-mono text-xs">profile</code> ·{" "}
          <code className="rounded bg-field px-1 font-mono text-xs">event</code>.
        </p>

        <Panel>
          <div className="flex flex-wrap items-center gap-4">
            <Button onClick={run} disabled={loading}>
              {loading ? "Exporting…" : "Export data"}
            </Button>
            {blob && stats ? (
              <a
                className="rounded bg-ink/10 px-4 py-2 text-sm font-semibold text-ink hover:bg-ink/20"
                download="cdp-us-export.ndjson"
                href={blob}
              >
                Download NDJSON ({stats.lines} lines)
              </a>
            ) : null}
          </div>
        </Panel>

        {error ? <ErrorState message={error} /> : null}

        {stats ? (
          <Panel>
            <h2 className="font-semibold">Export summary</h2>
            <dl className="mt-3 grid grid-cols-3 gap-4 text-center text-sm">
              <div>
                <dt className="text-ink/60">Total lines</dt>
                <dd className="text-2xl font-bold">{stats.lines}</dd>
              </div>
              <div>
                <dt className="text-ink/60">Profiles</dt>
                <dd className="text-2xl font-bold">{stats.profiles}</dd>
              </div>
              <div>
                <dt className="text-ink/60">Events</dt>
                <dd className="text-2xl font-bold">{stats.events}</dd>
              </div>
            </dl>
          </Panel>
        ) : null}

        {!stats && !error && !loading ? (
          <EmptyState
            title="No export yet"
            body="Click Export data to generate a portable NDJSON dump of all your profiles and events."
          />
        ) : null}
      </div>
    </Shell>
  );
}
