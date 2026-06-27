"use client";

import { useEffect, useState } from "react";
import { enableModule, getModules } from "../../src/api";
import { readSession, saveSession } from "../../src/session";
import type { ModuleManifest, Session } from "../../src/types";
import { Button, EmptyState, ErrorState, Panel, Shell } from "../../src/ui";

export default function ModulesPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [modules, setModules] = useState<readonly ModuleManifest[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    setSession(readSession());
    getModules().then(setModules).catch((err: unknown) => setError(String(err)));
  }, []);

  async function enable(key: string) {
    if (!session) return;
    try {
      const tenant = await enableModule(session.tenantId, key, session.apiToken);
      if (tenant) {
        const next = { ...session, tenant, tenantId: tenant.id };
        saveSession(next);
        setSession(next);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enable failed");
    }
  }

  return (
    <Shell>
      <div className="grid gap-5">
        <h1 className="text-2xl font-semibold">Modules</h1>
        {!session ? <EmptyState title="No token" body="Sign in before enabling modules." /> : null}
        {error ? <ErrorState message={error} /> : null}
        <div className="grid gap-3">
          {modules.map((item) => (
            <Panel className="grid gap-3 md:grid-cols-[1fr_auto]" key={item.key}>
              <div>
                <h2 className="font-semibold">{item.title}</h2>
                <p className="mt-1 text-sm text-ink/70">{item.description}</p>
                <p className="mt-2 text-xs text-ink/60">Consent: {item.requiresConsent.join(", ") || "none"}</p>
              </div>
              <Button disabled={!session} onClick={() => void enable(item.key)}>Enable</Button>
            </Panel>
          ))}
        </div>
      </div>
    </Shell>
  );
}
