"use client";

import { useEffect, useState } from "react";
import { enableModule, getModules } from "../../src/api";
import { readSession } from "../../src/session";
import type { ModuleManifest, Session } from "../../src/types";
import { StatTile } from "../../src/charts";
import { Badge, Button, EmptyState, ErrorState, Panel, Shell } from "../../src/ui";
import { ServiceActivityPanel } from "../../src/sections";

export default function ModulesPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [modules, setModules] = useState<readonly ModuleManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enabling, setEnabling] = useState<string | null>(null);

  useEffect(() => {
    const s = readSession();
    setSession(s);
    getModules()
      .then(setModules)
      .catch((err) => setError(err instanceof Error ? err.message : "Unknown error"))
      .finally(() => setLoading(false));
  }, []);

  const isEnabled = (key: string) =>
    session?.tenant?.enabledModules.includes(key) ?? false;

  const enable = async (key: string) => {
    if (!session) return;
    setEnabling(key);
    try {
      await enableModule(key, session.tenantId, session.apiToken);
      const updated = readSession();
      setSession(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setEnabling(null);
    }
  };

  if (loading) {
    return (
      <Shell>
        <div className="flex h-full items-center justify-center text-muted">Loading…</div>
      </Shell>
    );
  }

  if (error) {
    return <ErrorState message={error} />;
  }

  const enabledModules = modules.filter((m) => isEnabled(m.key));
  const availableModules = modules.filter((m) => !isEnabled(m.key));

  return (
    <Shell>
      <div className="space-y-8 p-4">
        <div>
          <p className="label">Platform modules</p>
          <h1 className="font-serif text-3xl font-bold text-ink">Turn on what you need.</h1>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label="Available" value={modules.length.toString()} />
          <StatTile label="Enabled" value={enabledModules.length.toString()} tone="sage" />
          <StatTile label="Add more" value={availableModules.length.toString()} tone="gold" />
        </div>

        <section>
          <h2 className="mb-3 font-serif text-xl font-semibold text-ink">Active modules</h2>
          {enabledModules.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {enabledModules.map((m) => (
                <Panel key={m.key}>
                  <div className="flex items-start justify-between">
                    <h3 className="font-semibold text-ink">{m.title}</h3>
                    <Badge tone="ok">Active</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted">{m.description}</p>
                  {m.requiresConsent.length > 0 && (
                    <p className="mt-2 font-mono text-[10px] text-muted">
                      Requires: {m.requiresConsent.join(", ")}
                    </p>
                  )}
                </Panel>
              ))}
            </div>
          ) : (
            <EmptyState title="No active modules" body="Enable a module below to get started." />
          )}
        </section>

        <section>
          <h2 className="mb-3 font-serif text-xl font-semibold text-ink">Add modules</h2>
          {availableModules.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {availableModules.map((m) => (
                <Panel key={m.key}>
                  <div className="flex items-start justify-between">
                    <h3 className="font-semibold text-ink">{m.title}</h3>
                    <Badge tone="neutral">Available</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted">{m.description}</p>
                  {m.requiresConsent.length > 0 && (
                    <p className="mt-2 font-mono text-[10px] text-muted">
                      Requires: {m.requiresConsent.join(", ")}
                    </p>
                  )}
                  {session && (
                    <div className="mt-4">
                      <Button
                        disabled={enabling === m.key}
                        onClick={() => enable(m.key)}
                      >
                        {enabling === m.key ? "Enabling…" : "Enable"}
                      </Button>
                    </div>
                  )}
                </Panel>
              ))}
            </div>
          ) : (
            <EmptyState title="All modules active" body="Every available module is already enabled." />
          )}
        </section>

        <ServiceActivityPanel />
      </div>
    </Shell>
  );
}
