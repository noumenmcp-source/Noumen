"use client";

import { useCallback, useEffect, useState } from "react";
import { readSession } from "../../src/session";
import type { Session } from "../../src/types";
import { StatTile } from "../../src/charts";
import { Badge, Button, EmptyState, ErrorState, Field, Panel, Shell } from "../../src/ui";

interface AuditEntry {
  tenantId: string;
  actor: { id: string; role: string };
  action: string;
  resource: { type: string; id: string };
  ts: string;
  metadata?: Record<string, unknown> | null;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8110";

/** Colour the action so reads, writes and erasures are scannable. */
function actionTone(action: string): "ok" | "gold" | "rust" | "neutral" {
  if (/delete|erase|revoke|disable/i.test(action)) return "rust";
  if (/create|enable|update|write|export/i.test(action)) return "gold";
  if (/read|view|list/i.test(action)) return "ok";
  return "neutral";
}

export default function AuditPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setSession(readSession()), []);

  const load = useCallback(async (s: Session) => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (action.trim()) params.set("action", action.trim());
    if (actor.trim()) params.set("actor", actor.trim());
    const qs = params.toString();
    try {
      const res = await fetch(`${API_URL}/v1/tenants/${s.tenantId}/audit${qs ? `?${qs}` : ""}`, {
        headers: { authorization: `Bearer ${s.apiToken}` },
      });
      if (res.status === 403) throw new Error("Admin role required to view the audit trail.");
      if (!res.ok) throw new Error(`Request failed (HTTP ${res.status})`);
      const data = await res.json();
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit trail.");
    } finally {
      setLoading(false);
    }
  }, [action, actor]);

  useEffect(() => {
    if (session?.tenantId) void load(session);
    // initial load only; filters apply on Apply click
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const actors = new Set(entries.map((e) => e.actor.id));
  const actions = new Set(entries.map((e) => e.action));

  return (
    <Shell>
      <div className="space-y-6 p-4">
        <div>
          <p className="label">Compliance</p>
          <h1 className="font-serif text-3xl font-bold text-ink">Audit trail.</h1>
          <p className="mt-1 text-sm text-muted">Every privileged action, tenant-isolated and tamper-evident.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile label="Entries" value={entries.length.toLocaleString()} tone="ink" />
          <StatTile label="Distinct actors" value={actors.size.toLocaleString()} tone="sage" />
          <StatTile label="Distinct actions" value={actions.size.toLocaleString()} tone="gold" />
        </div>

        <Panel>
          <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Field label="Action" value={action} onChange={setAction} />
            <Field label="Actor id" value={actor} onChange={setActor} />
            <Button disabled={loading || !session} onClick={() => session && void load(session)}>
              {loading ? "Loading…" : "Apply"}
            </Button>
          </div>
        </Panel>

        {error ? <ErrorState message={error} /> : null}

        {!error && entries.length === 0 && !loading ? (
          <EmptyState title="No audit entries" body="Privileged actions (DSAR, module changes, exports) will appear here." />
        ) : null}

        {entries.length > 0 ? (
          <Panel>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="py-2 pr-4 font-medium">When</th>
                  <th className="py-2 pr-4 font-medium">Actor</th>
                  <th className="py-2 pr-4 font-medium">Action</th>
                  <th className="py-2 pr-4 font-medium">Resource</th>
                </tr>
              </thead>
              <tbody>
                {entries.slice(0, 200).map((e, i) => (
                  <tr key={i} className="border-b border-line align-top">
                    <td className="py-2 pr-4 font-mono text-xs text-muted whitespace-nowrap">{e.ts.replace("T", " ").slice(0, 19)}</td>
                    <td className="py-2 pr-4">
                      <span className="font-mono text-xs">{e.actor.id}</span>
                      <Badge tone="muted">{e.actor.role}</Badge>
                    </td>
                    <td className="py-2 pr-4"><Badge tone={actionTone(e.action)}>{e.action}</Badge></td>
                    <td className="py-2 pr-4 font-mono text-xs text-muted">{e.resource.type}:{e.resource.id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {entries.length > 200 ? (
              <p className="mt-2 font-mono text-xs text-muted">Showing 200 of {entries.length.toLocaleString()}.</p>
            ) : null}
          </Panel>
        ) : null}
      </div>
    </Shell>
  );
}
