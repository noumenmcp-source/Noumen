"use client";

import { useState } from "react";
import { ApiError, runEmailCampaign } from "../../src/api";
import { readSession } from "../../src/session";
import { EMAIL_TRIGGERS, type CampaignResult, type EmailTrigger } from "../../src/types";
import { Badge, Button, EmptyState, ErrorState, Field, Panel, Shell } from "../../src/ui";
import { ChartCard, DonutChart, StatTile, type DonutSlice } from "../../src/charts";

function gateMessage(status: number): string {
  if (status === 402) return "Plan limit reached, or the email module is not entitled on your plan. Enable it under Modules / upgrade your plan.";
  if (status === 403) return "Forbidden — the email module is not enabled, or your role lacks admin rights.";
  return "Campaign failed.";
}

export default function EmailPage() {
  const [trigger, setTrigger] = useState<EmailTrigger>(EMAIL_TRIGGERS[0]);
  const [from, setFrom] = useState("");
  const [brandName, setBrandName] = useState("");
  const [productName, setProductName] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [physicalAddress, setPhysicalAddress] = useState("");
  const [unsubscribeUrl, setUnsubscribeUrl] = useState("");
  const [result, setResult] = useState<CampaignResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function run() {
    const session = readSession();
    if (!session) { setError("Sign in to run a campaign."); return; }
    if (!from.trim() || !brandName.trim() || !physicalAddress.trim() || !unsubscribeUrl.trim()) {
      setError("From, brand, physical address and unsubscribe URL are required (CAN-SPAM).");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      setResult(await runEmailCampaign(session.tenantId, session.apiToken, {
        trigger,
        from: from.trim(),
        brandName: brandName.trim(),
        ...(productName.trim() ? { productName: productName.trim() } : {}),
        ...(ctaUrl.trim() ? { ctaUrl: ctaUrl.trim() } : {}),
        physicalAddress: physicalAddress.trim(),
        unsubscribeUrl: unsubscribeUrl.trim(),
      }));
    } catch (err) {
      setError(err instanceof ApiError ? gateMessage(err.status) : "Campaign failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Shell>
      <div className="grid gap-5">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold">Email Campaigns</h1>
          {result ? <Badge tone="ok">{result.sent} sent</Badge> : null}
        </div>
        <p className="text-sm text-ink/70">
          Run a triggered campaign over your live profiles. Only recipients with
          <strong> marketing_email</strong> consent are sent to; CAN-SPAM fields are mandatory.
        </p>

        <Panel className="grid gap-3">
          <label className="grid gap-1 text-sm font-medium text-ink">
            <span>Trigger</span>
            <select className="input" value={trigger} onChange={(e) => setTrigger(e.target.value as EmailTrigger)}>
              {EMAIL_TRIGGERS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From" value={from} onChange={setFrom} required />
            <Field label="Brand name" value={brandName} onChange={setBrandName} required />
            <Field label="Product name (optional)" value={productName} onChange={setProductName} />
            <Field label="CTA URL (optional)" value={ctaUrl} onChange={setCtaUrl} />
            <Field label="Physical address (CAN-SPAM)" value={physicalAddress} onChange={setPhysicalAddress} required />
            <Field label="Unsubscribe URL (CAN-SPAM)" value={unsubscribeUrl} onChange={setUnsubscribeUrl} required />
          </div>
          <Button onClick={run} disabled={loading}>{loading ? "Sending…" : "Run campaign"}</Button>
        </Panel>

        {error ? <ErrorState message={error} /> : null}

        {result ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatTile label="Selected" value={result.selected.toLocaleString()} tone="ink" />
              <StatTile label="Sent" value={result.sent.toLocaleString()} tone="sage" />
              <StatTile
                label="Skipped (no consent)"
                value={result.skippedNoConsent.toLocaleString()}
                tone="rust"
                hint={result.selected > 0 ? `${((result.sent / result.selected) * 100).toFixed(0)}% reach` : undefined}
              />
            </div>

            {result.selected > 0 ? (
              <ChartCard title="Consent reach" subtitle="Sent vs suppressed for lack of marketing consent">
                <DonutChart
                  slices={[
                    { label: "Sent", value: result.sent, tone: "sage" },
                    { label: "No consent", value: result.skippedNoConsent, tone: "rust" },
                  ].filter((s) => s.value > 0) as DonutSlice[]}
                  centerValue={`${((result.sent / result.selected) * 100).toFixed(0)}%`}
                  centerLabel="reached"
                />
              </ChartCard>
            ) : null}
          </>
        ) : null}

        {!result && !error && !loading ? (
          <EmptyState title="No campaign run yet" body="Fill in the campaign and click Run campaign." />
        ) : null}
      </div>
    </Shell>
  );
}
