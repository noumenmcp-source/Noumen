"use client";

import { useEffect, useState } from "react";
import { trackerSnippet } from "../../src/api";
import { readSession } from "../../src/session";
import type { Session } from "../../src/types";
import { Badge, Button, EmptyState, ErrorState, Panel, Shell } from "../../src/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8110";

interface Source {
  key: string;
  name: string;
  category: string;
  mode: "webhook" | "upload" | "snippet";
  requiresSecret: boolean;
  description: string;
  connected: boolean;
  endpoint: string;
}

export default function ConnectPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [sources, setSources] = useState<Source[] | null>(null);
  const [error, setError] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const s = readSession();
    setSession(s);
    if (!s?.tenantId) return;
    fetch(`${API_URL}/v1/tenants/${s.tenantId}/sources`, { headers: { authorization: `Bearer ${s.apiToken}` } })
      .then(async (res) => (res.ok ? ((await res.json()) as { sources: Source[] }) : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body) => setSources(body.sources))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "failed to load sources"));
  }, []);

  const writeKey = session?.tenant?.writeKey ?? "";
  const snippet = writeKey ? trackerSnippet(writeKey) : "";
  const connected = sources?.filter((s) => s.connected).length ?? 0;

  async function copySnippet() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
  }

  return (
    <Shell>
      <div className="grid gap-5">
        <div className="flex items-end justify-between gap-3">
          <h1 className="text-2xl font-semibold">Sources</h1>
          {sources ? <span className="text-sm text-slate-500">{connected}/{sources.length} connected</span> : null}
        </div>
        <p className="text-sm text-slate-500">Collect from everywhere — webhooks, file uploads and the on-site snippet all land as unified profiles.</p>

        {error ? <ErrorState message={error} /> : null}
        {!sources && !error ? <EmptyState title="Loading sources" body="Fetching the connector catalog…" /> : null}

        {sources ? (
          <div className="grid gap-3 md:grid-cols-2">
            {sources.map((source) => (
              <Panel key={source.key}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{source.name}</h2>
                    <p className="mt-1 text-sm text-slate-500">{source.description}</p>
                  </div>
                  <Badge tone={source.connected ? "ok" : "neutral"}>{source.connected ? "Connected" : "Set up"}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="rounded bg-slate-100 px-2 py-0.5">{source.category}</span>
                  <span className="rounded bg-slate-100 px-2 py-0.5">{source.mode}</span>
                  <code className="truncate">{source.endpoint}</code>
                </div>
              </Panel>
            ))}
          </div>
        ) : null}

        {writeKey ? (
          <Panel>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">On-site snippet</h2>
              <Button onClick={() => void copySnippet()}>{copied ? "Copied" : "Copy"}</Button>
            </div>
            <pre className="mt-4 overflow-x-auto rounded-md bg-ink p-4 text-sm text-white"><code>{snippet}</code></pre>
          </Panel>
        ) : null}
      </div>
    </Shell>
  );
}
