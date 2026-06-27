"use client";

import { useEffect, useState } from "react";
import { enableModule, getModules } from "../../src/api";
import { readSession, saveSession } from "../../src/session";
import type { ModuleManifest, Session } from "../../src/types";
import { Badge, Button, EmptyState, ErrorState, PageHeader, Shell } from "../../src/ui";

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
        <PageHeader
          eyebrow="Plan enforcement"
          title="Modules"
          body="Enable tenant capabilities after entitlement checks. API returns billing or authorization errors before any state change."
        />
        {!session ? <EmptyState title="No token" body="Sign in before enabling modules." /> : null}
        {error ? <ErrorState message={error} /> : null}
        <div className="table-shell overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="table-head">
              <tr>
                <th className="px-4 py-3">Module</th>
                <th className="px-4 py-3">Consent</th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {modules.map((item) => {
                const isEnabled = session?.tenant?.enabledModules.includes(item.key) ?? false;
                return (
                  <tr className="table-row" key={item.key}>
                    <td className="max-w-xl px-4 py-4">
                      <p className="font-medium">{item.title}</p>
                      <p className="mt-1 text-sm text-muted">{item.description}</p>
                    </td>
                    <td className="px-4 py-4 text-muted">{item.requiresConsent.join(", ") || "none"}</td>
                    <td className="px-4 py-4">
                      <Badge tone={isEnabled ? "ok" : "neutral"}>{isEnabled ? "Enabled" : "Available"}</Badge>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <Button disabled={!session || isEnabled} onClick={() => void enable(item.key)} variant={isEnabled ? "secondary" : "primary"}>
                        {isEnabled ? "Enabled" : "Enable"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
