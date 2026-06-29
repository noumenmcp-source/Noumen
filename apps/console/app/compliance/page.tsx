"use client";

import { useState } from "react";
import { ApiError, dsarRequest } from "../../src/api";
import { readSession } from "../../src/session";
import type { DsarKind } from "../../src/types";
import { Badge, Button, EmptyState, ErrorState, Field, Panel, Shell } from "../../src/ui";
import { StatTile } from "../../src/charts";

const KINDS: { readonly value: DsarKind; readonly label: string }[] = [
  { value: "access", label: "Access (export everything we hold)" },
  { value: "delete", label: "Delete (erase / plan erasure)" },
  { value: "correct", label: "Correct (tombstone profile)" },
];

interface ConsentRow { source: string; field: string; value: unknown }

function consentRows(report: Record<string, unknown>): ConsentRow[] {
  const cats = report.categories;
  if (typeof cats !== "object" || cats === null) return [];
  const activity = (cats as Record<string, unknown>).internet_activity;
  if (!Array.isArray(activity)) return [];
  return activity.filter(
    (r): r is ConsentRow =>
      typeof r === "object" && r !== null && "source" in r && (r as ConsentRow).source === "consent",
  );
}

export default function CompliancePage() {
  const [subject, setSubject] = useState("");
  const [kind, setKind] = useState<DsarKind>("access");
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function run() {
    const session = readSession();
    if (!session) { setError("Sign in to run a DSAR."); return; }
    if (!subject.trim()) { setError("Enter a subject (email or userId)."); return; }
    setLoading(true);
    setError("");
    setPayload(null);
    try {
      setPayload(await dsarRequest(session.tenantId, session.apiToken, subject.trim(), kind));
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403
        ? "Forbidden — admin role required for DSAR actions."
        : "DSAR request failed.");
    } finally {
      setLoading(false);
    }
  }

  const report = payload && typeof payload.report === "object" && payload.report !== null
    ? (payload.report as Record<string, unknown>)
    : null;
  const consent = report ? consentRows(report) : [];

  return (
    <Shell>
      <div className="grid gap-5">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold">Compliance · DSAR</h1>
          {payload ? <Badge tone="ok">{String(payload.kind ?? kind)}</Badge> : null}
        </div>
        <p className="text-sm text-ink/70">
          CCPA/CPRA data-subject requests: access, delete, or correct everything held for a subject.
          Access reports include the subject&apos;s recorded consent state.
        </p>

        <Panel className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Subject (email or userId)" value={subject} onChange={setSubject} />
          <label className="grid gap-1 text-sm font-medium text-ink">
            <span>Request kind</span>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as DsarKind)}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
          </label>
          <Button onClick={run} disabled={loading}>{loading ? "Running…" : "Submit DSAR"}</Button>
        </Panel>

        {error ? <ErrorState message={error} /> : null}

        {consent.length > 0 ? (
          <Panel>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Recorded consent</h2>
              <StatTile
                label="Granted"
                value={`${consent.filter((c) => c.value).length}/${consent.length}`}
                tone={consent.every((c) => c.value) ? "sage" : consent.some((c) => c.value) ? "gold" : "rust"}
              />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              {consent.map((c) => (
                <div key={c.field} className="flex items-center gap-2">
                  <span className={`inline-block h-2 w-2 rounded-full ${c.value ? "bg-emerald-500" : "bg-red-400"}`} />
                  <dt className="text-ink/70">{c.field}</dt>
                  <dd className="font-medium">{String(c.value)}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        ) : null}

        {payload ? (
          <Panel>
            <h2 className="font-semibold">Raw response</h2>
            <pre className="mt-2 max-h-[420px] overflow-auto rounded bg-ink/5 p-3 text-xs">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </Panel>
        ) : null}

        {!payload && !error && !loading ? (
          <EmptyState title="No request run yet" body="Enter a subject, pick a request kind, and Submit DSAR." />
        ) : null}
      </div>
    </Shell>
  );
}
