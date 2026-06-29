"use client";

import { useEffect, useState } from "react";
import { readSession } from "../../src/session";
import { StatTile } from "../../src/charts";
import { EmptyState, ErrorState, Shell } from "../../src/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8110";

interface Action { key: string; kind: string; title: string; channel: string; stage: string; audienceSize: number; impact: number; rationale: string; copyValid: boolean | null; copy: { subject?: string; body: string } | null; }
interface Channel { channel: string; profiles: number; conversionRate: number; repeatRate: number; avgValue: number; neverClosedRate: number; }
interface Audit { total: number; stages: Record<string, number>; channels: Channel[]; actions: Action[]; }

type CardTone = "gold" | "sage" | "rust" | "muted";
type CardSignal = { label: string; tone: CardTone; bold: string; body: string };

function buildCards(audit: Audit): CardSignal[] {
  const { stages, channels, actions, total } = audit;
  const cards: CardSignal[] = [];

  if ((stages.dormant ?? 0) > 0)
    cards.push({ label: "Money in dormant", tone: "gold", bold: `${(stages.dormant ?? 0).toLocaleString()} customers`, body: "haven't bought in 90 days. Cheaper to win back than buy new." });

  const badCh = [...channels].sort((a, b) => b.neverClosedRate - a.neverClosedRate)[0];
  if (badCh && badCh.neverClosedRate > 0.4)
    cards.push({ label: "Bad channel", tone: "rust", bold: `${badCh.channel}:`, body: `${badCh.profiles} leads, ${Math.round(badCh.neverClosedRate * 100)}% never closed. Check the audience.` });

  const goodCh = [...channels].sort((a, b) => b.repeatRate - a.repeatRate)[0];
  if (goodCh && goodCh.repeatRate > 0)
    cards.push({ label: "Good channel", tone: "sage", bold: `${goodCh.channel}:`, body: `${Math.round(goodCh.repeatRate * 100)}% repeat, AOV $${Math.round(goodCh.avgValue)}. Don't cut it.` });

  if ((stages.new ?? 0) > 0)
    cards.push({ label: "CRM hole", tone: "rust", bold: `${(stages.new ?? 0).toLocaleString()} new leads`, body: "with no purchases yet. Chase before they go cold." });

  const top = actions[0];
  if (top)
    cards.push({ label: "→ Action of the day", tone: "muted", bold: top.title, body: `${top.audienceSize} ${top.stage} customers · via ${top.channel}.` });

  if ((stages.vip ?? 0) > 0)
    cards.push({ label: "Where growth is", tone: "sage", bold: `${(stages.vip ?? 0).toLocaleString()} customers`, body: "look like VIPs — build a lookalike audience from them." });

  if (cards.length === 0 && total > 0)
    cards.push({ label: "Base", tone: "muted", bold: `${total.toLocaleString()} profiles`, body: "unified in your base. Connect more sources to surface money." });

  return cards;
}

const LABEL_CLS: Record<CardTone, string> = { gold: "text-gold", sage: "text-sage", rust: "text-rust", muted: "text-muted" };
const BORDER_CLS: Record<CardTone, string> = { gold: "[border-left-color:#c9a84c]", sage: "[border-left-color:#4a7c59]", rust: "[border-left-color:#c4683a]", muted: "[border-left-color:#e0d8cc]" };

function ActionCard({ card }: { readonly card: CardSignal }) {
  return (
    <div className={`rounded-lg border border-line border-l-4 bg-panel p-4 shadow-card ${BORDER_CLS[card.tone]}`}>
      <p className={`label mb-2 ${LABEL_CLS[card.tone]}`}>{card.label}</p>
      <p className="text-sm leading-snug text-ink">
        <span className="font-semibold">{card.bold}</span>{" "}{card.body}
      </p>
    </div>
  );
}

function StageChip({ stage, count }: { readonly stage: string; readonly count: number }) {
  const cls: Record<string, string> = {
    vip: "border-[#c9a84c]/40 text-[#c9a84c]", active: "border-[#4a7c59]/40 text-[#4a7c59]",
    new: "border-[#4a7c59]/20 text-[#4a7c59]", dormant: "border-[#c9a84c]/30 text-[#c9a84c]",
    lost: "border-[#c4683a]/30 text-[#c4683a]", junk: "border-line text-muted",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-xs ${cls[stage] ?? "border-line text-muted"}`}>
      {stage} · <b>{count.toLocaleString()}</b>
    </span>
  );
}

const STAGE_ORDER = ["vip", "active", "new", "dormant", "lost", "junk"] as const;

export default function TodayPage() {
  const [audit, setAudit] = useState<Audit | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const session = readSession();
    if (!session) { setError("Sign in first."); setLoading(false); return; }
    (async () => {
      try {
        const res = await fetch(`${API_URL}/v1/tenants/${session.tenantId}/report/base-audit`, {
          headers: { authorization: `Bearer ${session.apiToken}` }, cache: "no-store",
        });
        if (res.status === 401) return setError("Unauthorized. Please sign in again.");
        if (res.status === 403) return setError("Forbidden: needs analyst/admin role.");
        if (!res.ok) return setError(`Request failed (HTTP ${res.status})`);
        const data = (await res.json()) as Record<string, unknown>;
        const base = (data.base ?? {}) as Record<string, unknown>;
        setAudit({
          total: typeof base.total === "number" ? base.total : 0,
          stages: (base.stages ?? {}) as Record<string, number>,
          channels: Array.isArray(data.channels) ? (data.channels as Channel[]) : [],
          actions: Array.isArray(data.playbook) ? (data.playbook as Action[]) : [],
        });
      } catch { setError("Network error."); }
      finally { setLoading(false); }
    })();
  }, []);

  const cards = audit ? buildCards(audit) : [];

  return (
    <Shell>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <p className="label text-muted">Today in your base</p>
          <h1 className="mt-1 font-serif text-3xl font-bold leading-tight text-ink">Where the money is.</h1>
        </div>
        {audit ? (
          <span className="flex items-center gap-2 rounded-full border border-[#4a7c59]/40 bg-[#4a7c59]/10 px-4 py-1.5 font-mono text-xs font-medium text-[#4a7c59]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#4a7c59]" />
            {audit.actions.length} actions today
          </span>
        ) : null}
      </div>

      {error ? <ErrorState message={error} /> : null}
      {loading ? <EmptyState title="Loading your base…" body="Reading profiles and events." /> : null}

      {audit ? (
        <div className="grid gap-6">
          <div className="grid gap-4 sm:grid-cols-4">
            <StatTile label="Total profiles" value={audit.total.toLocaleString()} />
            <StatTile label="Actions today" value={audit.actions.length.toString()} tone="gold" />
            <StatTile label="VIP customers" value={(audit.stages.vip ?? 0).toLocaleString()} tone="sage" />
            <StatTile label="At-risk" value={((audit.stages.dormant ?? 0) + (audit.stages.lost ?? 0)).toLocaleString()} tone="rust" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {STAGE_ORDER.map((s) => <StageChip key={s} stage={s} count={audit.stages[s] ?? 0} />)}
            <span className="ml-auto font-mono text-xs text-muted">{audit.total.toLocaleString()} total</span>
          </div>

          {cards.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {cards.map((card) => <ActionCard key={card.label} card={card} />)}
            </div>
          ) : (
            <EmptyState title="Nothing to surface yet" body="Connect a source so AXIOM can find money in your base." />
          )}

          {audit.actions.length > 0 ? (
            <div className="rounded-lg border border-[#4a7c59]/30 bg-[#4a7c59]/5 px-4 py-3 font-mono text-xs text-[#4a7c59]">
              <span className="mr-2 inline-block h-1.5 w-1.5 translate-y-[1px] rounded-full bg-[#4a7c59]" />
              Ready to export: segments, copy, tasks, audiences
            </div>
          ) : null}
        </div>
      ) : null}
    </Shell>
  );
}
