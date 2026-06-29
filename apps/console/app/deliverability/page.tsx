"use client";

import { useState } from "react";
import { readSession } from "../../src/session";
import { Badge, Button, EmptyState, ErrorState, Field, Panel, Shell } from "../../src/ui";
import { StatTile } from "../../src/charts";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8110";

function gate(status: number): string | null {
  if (status === 401 || status === 403) return "Forbidden: needs analyst/admin role or module not enabled";
  if (status === 402) return "Plan limit / not entitled";
  if (status >= 400) return `Request failed (HTTP ${status})`;
  return null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

export default function DeliverabilityPage() {
  // Tool A — auth records check
  const [spf, setSpf] = useState("");
  const [dmarc, setDmarc] = useState("");
  const [dkim, setDkim] = useState("");
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [checkError, setCheckError] = useState("");
  const [checking, setChecking] = useState(false);

  // Tool B — suppression lookup
  const [email, setEmail] = useState("");
  const [suppressed, setSuppressed] = useState<boolean | null>(null);
  const [entry, setEntry] = useState<Record<string, unknown> | null>(null);
  const [supError, setSupError] = useState("");
  const [looking, setLooking] = useState(false);

  async function runCheck() {
    const session = readSession();
    if (!session) { setCheckError("Sign in first."); return; }
    setChecking(true);
    setCheckError("");
    setReport(null);
    const body: { spf?: string; dmarc?: string; dkim?: string[] } = {};
    if (spf.trim()) body.spf = spf.trim();
    if (dmarc.trim()) body.dmarc = dmarc.trim();
    const dk = dkim.split(",").map((s) => s.trim()).filter(Boolean);
    if (dk.length) body.dkim = dk;
    try {
      const res = await fetch(`${API_URL}/v1/tenants/${session.tenantId}/deliverability/check`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.apiToken}` },
        body: JSON.stringify(body),
      });
      const g = gate(res.status);
      if (g) { setCheckError(g); return; }
      const data = asRecord(await res.json());
      const rep = data ? asRecord(data.report) : null;
      if (!rep) { setCheckError("Unexpected response shape."); return; }
      setReport(rep);
    } catch { setCheckError("Network error."); }
    finally { setChecking(false); }
  }

  async function runLookup() {
    const session = readSession();
    if (!session) { setSupError("Sign in first."); return; }
    if (!email.trim()) { setSupError("Enter an email."); return; }
    setLooking(true);
    setSupError("");
    setSuppressed(null);
    setEntry(null);
    try {
      const url = `${API_URL}/v1/tenants/${session.tenantId}/deliverability/suppression?email=${encodeURIComponent(email.trim())}`;
      const res = await fetch(url, { headers: { authorization: `Bearer ${session.apiToken}` } });
      const g = gate(res.status);
      if (g) { setSupError(g); return; }
      const data = asRecord(await res.json());
      if (!data) { setSupError("Unexpected response shape."); return; }
      setSuppressed(data.suppressed === true);
      setEntry(asRecord(data.entry));
    } catch { setSupError("Network error."); }
    finally { setLooking(false); }
  }

  return (
    <Shell>
      <div className="grid gap-5">
        <h1 className="text-2xl font-semibold">Deliverability</h1>

        <Panel className="grid gap-3">
          <h2 className="font-semibold">Auth records check (SPF / DMARC / DKIM)</h2>
          <Field label="SPF record" value={spf} onChange={setSpf} />
          <Field label="DMARC record" value={dmarc} onChange={setDmarc} />
          <Field label="DKIM selectors (comma-separated)" value={dkim} onChange={setDkim} />
          <Button onClick={runCheck} disabled={checking}>{checking ? "Checking…" : "Check records"}</Button>
          {checkError ? <ErrorState message={checkError} /> : null}
          {report ? (() => {
            const bools = Object.values(report).filter((v) => typeof v === "boolean") as boolean[];
            const passed = bools.filter(Boolean).length;
            return bools.length > 0 ? (
              <StatTile
                label="Auth records valid"
                value={`${passed}/${bools.length}`}
                tone={passed === bools.length ? "sage" : passed === 0 ? "rust" : "gold"}
              />
            ) : null;
          })() : null}
          {report ? (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              {Object.entries(report).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2">
                  {typeof v === "boolean" ? (
                    <span className={`inline-block h-2 w-2 rounded-full ${v ? "bg-emerald-500" : "bg-red-400"}`} />
                  ) : null}
                  <dt className="text-ink/70">{k}</dt>
                  <dd className="font-medium">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </Panel>

        <Panel className="grid gap-3">
          <h2 className="font-semibold">Suppression lookup</h2>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label="Email" value={email} onChange={setEmail} type="email" />
            <Button onClick={runLookup} disabled={looking}>{looking ? "Looking…" : "Look up"}</Button>
          </div>
          {supError ? <ErrorState message={supError} /> : null}
          {suppressed !== null ? (
            <div className="grid gap-2">
              <div className="flex items-center gap-2 text-sm">
                <span>{email}</span>
                <Badge tone={suppressed ? "hot" : "ok"}>{suppressed ? "suppressed" : "deliverable"}</Badge>
              </div>
              {entry ? (
                <pre className="max-h-60 overflow-auto rounded bg-field p-3 text-xs">{JSON.stringify(entry, null, 2)}</pre>
              ) : null}
            </div>
          ) : null}
        </Panel>

        {!report && !checkError && suppressed === null && !supError ? (
          <EmptyState title="Two tools" body="Validate SPF/DMARC/DKIM records, or look up whether an address is suppressed." />
        ) : null}
      </div>
    </Shell>
  );
}
