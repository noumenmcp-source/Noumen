"use client";

import { useState } from "react";
import { readSession } from "../../src/session";
import { Button, EmptyState, ErrorState, Field, Panel, Shell } from "../../src/ui";

interface ConsentState {
  analytics: boolean;
  marketing_email: boolean;
  sale_or_share: boolean;
  messaging_tcpa: boolean;
  gpc: boolean;
}

interface ConsentRecord {
  id: string;
  subject: string;
  ts: string;
  state: ConsentState;
  verified: boolean;
}

interface ConsentResponse {
  state: ConsentState | null;
  records: ConsentRecord[];
  verified: boolean;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8110";

async function fetchConsent(
  tenantId: string,
  token: string,
  subject: string,
): Promise<ConsentResponse> {
  const res = await fetch(
    `${API_URL}/v1/tenants/${tenantId}/consent/${encodeURIComponent(subject)}`,
    { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<ConsentResponse>;
}

const CONSENT_LABELS: Record<keyof ConsentState, string> = {
  analytics: "Analytics",
  marketing_email: "Marketing email",
  sale_or_share: "Sale / share",
  messaging_tcpa: "Messaging (TCPA)",
  gpc: "GPC signal",
};

export default function ConsentPage() {
  const [subject, setSubject] = useState("");
  const [data, setData] = useState<ConsentResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function lookup() {
    const session = readSession();
    if (!session) { setError("Sign in first."); return; }
    if (!subject.trim()) { setError("Enter a subject (email or userId)."); return; }
    setLoading(true);
    setError("");
    setData(null);
    try {
      setData(await fetchConsent(session.tenantId, session.apiToken, subject.trim()));
    } catch {
      setError("Could not load consent records.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Shell>
      <div className="grid gap-5">
        <h1 className="text-2xl font-semibold">Consent Ledger</h1>

        <Panel>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field
              label="Subject (email or userId)"
              value={subject}
              onChange={setSubject}
            />
            <Button onClick={lookup} disabled={loading}>
              {loading ? "Loading…" : "Look up"}
            </Button>
          </div>
        </Panel>

        {error ? <ErrorState message={error} /> : null}

        {data ? (
          <div className="grid gap-4">
            <Panel>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Current state</h2>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    data.verified
                      ? "bg-green-100 text-green-800"
                      : "bg-yellow-100 text-yellow-800"
                  }`}
                >
                  {data.verified ? "Chain verified" : "Unverified"}
                </span>
              </div>
              {data.state ? (
                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                  {(Object.keys(CONSENT_LABELS) as (keyof ConsentState)[]).map((key) => (
                    <div key={key} className="flex items-center gap-2">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          data.state![key] ? "bg-green-500" : "bg-red-400"
                        }`}
                      />
                      <dt className="text-ink/70">{CONSENT_LABELS[key]}</dt>
                      <dd className="font-medium">{data.state![key] ? "Yes" : "No"}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-2 text-sm text-ink/60">No consent recorded yet.</p>
              )}
            </Panel>

            {data.records.length > 0 ? (
              <Panel>
                <h2 className="font-semibold">History ({data.records.length} records)</h2>
                <ol className="mt-3 grid gap-3">
                  {data.records.map((rec, i) => (
                    <li key={rec.id} className="grid gap-1 border-b border-line pb-3 last:border-0 last:pb-0">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-mono text-xs text-ink/50">#{i + 1}</span>
                        <time className="text-xs text-ink/50">{new Date(rec.ts).toLocaleString()}</time>
                      </div>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-5">
                        {(Object.keys(CONSENT_LABELS) as (keyof ConsentState)[]).map((key) => (
                          <div key={key} className="flex items-center gap-1">
                            <span className={rec.state[key] ? "text-green-600" : "text-red-500"}>
                              {rec.state[key] ? "✓" : "✗"}
                            </span>
                            <span className="text-ink/60">{CONSENT_LABELS[key]}</span>
                          </div>
                        ))}
                      </dl>
                    </li>
                  ))}
                </ol>
              </Panel>
            ) : (
              <EmptyState title="No history" body="No consent records found for this subject." />
            )}
          </div>
        ) : null}
      </div>
    </Shell>
  );
}
