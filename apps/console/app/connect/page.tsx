"use client";

import { useEffect, useState } from "react";
import { readSession } from "../../src/session";
import { trackerSnippet } from "../../src/api";
import type { Session } from "../../src/types";
import { StatTile } from "../../src/charts";
import { Badge, Button, EmptyState, ErrorState, Panel, Shell } from "../../src/ui";

interface Source {
  key: string;
  name: string;
  category: string;
  mode: string;
  requiresSecret: boolean;
  description: string;
  connected: boolean;
  endpoint: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8110";

export default function ConnectPage() {
  const [session] = useState<Session | null>(() => readSession());
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.tenantId) {
      setLoading(false);
      return;
    }
    fetch(`${API_URL}/v1/tenants/${session.tenantId}/sources`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to fetch sources");
        return r.json();
      })
      .then((data) => setSources(data.sources ?? []))
      .catch((err) => setError(err instanceof Error ? err.message : "Unknown error"))
      .finally(() => setLoading(false));
  }, [session?.tenantId]);

  const connectedCount = sources.filter((s) => s.connected).length;
  const pendingCount = sources.length - connectedCount;

  if (loading) {
    return (
      <Shell>
        <div className="flex h-full items-center justify-center">
          <div className="text-muted">Loading…</div>
        </div>
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <ErrorState message={error} />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="space-y-6 p-4">
        <div>
          <p className="label">Data connections</p>
          <h1 className="font-serif text-3xl font-bold text-ink">Every source, one base.</h1>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label="Sources available" value={sources.length.toString()} tone="ink" />
          <StatTile label="Connected" value={connectedCount.toString()} tone="sage" />
          <StatTile label="Pending setup" value={pendingCount.toString()} tone="rust" />
        </div>

        {sources.length === 0 ? (
          <EmptyState title="No sources found" body="There are no data sources configured for this tenant." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {sources.map((source) => (
              <Panel key={source.key}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-ink">{source.name}</h3>
                    <Badge tone={source.connected ? "ok" : "neutral"}>
                      {source.connected ? "Connected" : "Set up"}
                    </Badge>
                  </div>
                </div>
                <p className="mt-1 text-sm text-muted">{source.description}</p>
                <div className="mt-3 flex items-center gap-2">
                  <span className="rounded border border-line bg-cream px-2 py-0.5 font-mono text-[10px]">
                    {source.category}
                  </span>
                  <span className="truncate font-mono text-[10px] text-muted">{source.mode}</span>
                  <span className="truncate font-mono text-[10px] text-muted">{source.endpoint}</span>
                </div>
              </Panel>
            ))}
          </div>
        )}

        {session?.tenant?.writeKey && (
          <Panel>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-ink">On-site snippet</h3>
              <Button onClick={() => navigator.clipboard.writeText(trackerSnippet(session.tenant!.writeKey))}>
                Copy
              </Button>
            </div>
            <pre className="mt-2 overflow-x-auto rounded bg-cream p-2 text-xs text-ink">
              {trackerSnippet(session.tenant.writeKey)}
            </pre>
          </Panel>
        )}
      </div>
    </Shell>
  );
}
