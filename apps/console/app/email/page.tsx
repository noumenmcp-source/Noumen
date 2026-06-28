"use client";

import { useState } from "react";
import { readSession } from "../../src/session";
import { Button, EmptyState, ErrorState, Field, Panel, Shell } from "../../src/ui";

interface CampaignResult {
  sent: number;
  suppressed: number;
  campaignId: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8110";

async function sendCampaign(
  tenantId: string,
  token: string,
  payload: { subject: string; body: string; segmentRule: unknown[] },
): Promise<CampaignResult> {
  const res = await fetch(`${API_URL}/v1/tenants/${tenantId}/email/campaigns`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (res.status === 402) throw new Error("Plan limit reached or billing inactive.");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<CampaignResult>;
}

export default function EmailPage() {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [filterField, setFilterField] = useState("firmographics.company");
  const [filterValue, setFilterValue] = useState("");
  const [result, setResult] = useState<CampaignResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function launch() {
    const session = readSession();
    if (!session) { setError("Sign in first."); return; }
    if (!subject.trim() || !body.trim()) {
      setError("Subject and body are required.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    const rule = filterValue.trim()
      ? [{ path: filterField, equals: filterValue.trim() }]
      : [];
    try {
      setResult(await sendCampaign(session.tenantId, session.apiToken, {
        subject: subject.trim(),
        body: body.trim(),
        segmentRule: rule,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Campaign failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Shell>
      <div className="grid gap-5">
        <h1 className="text-2xl font-semibold">Email Campaigns</h1>
        <p className="text-sm text-ink/60">
          Requires <strong>email</strong> module enabled. Only profiles with marketing_email
          consent receive the campaign.
        </p>

        <Panel>
          <div className="grid gap-4">
            <Field label="Subject" value={subject} onChange={setSubject} required />
            <label className="grid gap-1 text-sm font-medium text-ink">
              Body
              <textarea
                className="input min-h-[120px] resize-y"
                required
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>

            <fieldset className="grid gap-3 rounded border border-line p-3">
              <legend className="px-1 text-sm font-medium text-ink">
                Segment filter (optional — blank = all profiles)
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  Field
                  <select
                    className="rounded border border-ink/20 bg-transparent p-2"
                    value={filterField}
                    onChange={(e) => setFilterField(e.target.value)}
                  >
                    {["firmographics.company", "firmographics.industry", "firmographics.country", "email"].map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </label>
                <Field label="Equals" value={filterValue} onChange={setFilterValue} />
              </div>
            </fieldset>

            <Button onClick={launch} disabled={loading}>
              {loading ? "Sending…" : "Launch campaign"}
            </Button>
          </div>
        </Panel>

        {error ? <ErrorState message={error} /> : null}

        {result ? (
          <Panel>
            <h2 className="font-semibold text-green-700">Campaign queued</h2>
            <dl className="mt-3 grid grid-cols-3 gap-4 text-center text-sm">
              <div>
                <dt className="text-ink/60">Sent</dt>
                <dd className="text-2xl font-bold">{result.sent}</dd>
              </div>
              <div>
                <dt className="text-ink/60">Suppressed</dt>
                <dd className="text-2xl font-bold">{result.suppressed}</dd>
              </div>
              <div>
                <dt className="text-ink/60">Campaign ID</dt>
                <dd className="font-mono text-xs text-ink/60 mt-1 break-all">{result.campaignId}</dd>
              </div>
            </dl>
          </Panel>
        ) : null}

        {!result && !error && !loading ? (
          <EmptyState
            title="No campaigns yet"
            body="Fill in the form above and click Launch to send your first campaign."
          />
        ) : null}
      </div>
    </Shell>
  );
}
