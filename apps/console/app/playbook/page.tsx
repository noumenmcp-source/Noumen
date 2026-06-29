"use client";

import { useEffect, useState } from "react";
import { readSession } from "../../src/session";
import { Badge, EmptyState, ErrorState, Panel, Shell } from "../../src/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8110";

type Stage = "new" | "active" | "dormant" | "lost" | "vip" | "junk";

interface Action {
  key: string;
  kind: string;
  title: string;
  stage: Stage;
  channel: string;
  audienceSize: number;
  impact: number;
  rationale: string;
}

interface PlaybookResponse {
  ok: boolean;
  total: number;
  stages: Partial<Record<Stage, number>>;
  actions: Action[];
}

const CHANNEL_LABEL: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  task: "Rep task",
  ad_audience: "Ad audience",
};

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function asAction(v: unknown): Action | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.key !== "string" || typeof r.title !== "string") return null;
  return {
    key: r.key,
    kind: typeof r.kind === "string" ? r.kind : "",
    title: r.title,
    stage: (typeof r.stage === "string" ? r.stage : "new") as Stage,
    channel: typeof r.channel === "string" ? r.channel : "",
    audienceSize: num(r.audienceSize),
    impact: num(r.impact),
    rationale: typeof r.rationale === "string" ? r.rationale : "",
  };
}

export default function PlaybookPage() {
  const [data, setData] = useState<PlaybookResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const session = readSession();
    if (!session) {
      setError("Sign in to load the playbook.");
      setLoading(false);
      return;
    }
    fetch(`${API_URL}/v1/tenants/${session.tenantId}/playbook`, {
      headers: { authorization: `Bearer ${session.apiToken}` },
      cache: "no-store",
    })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          throw new Error("Forbidden — analyst role required.");
        }
        if (!res.ok) throw new Error(`Request failed (HTTP ${res.status})`);
        const raw: unknown = await res.json();
        const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
        const actions = Array.isArray(r.actions)
          ? r.actions.map(asAction).filter((a): a is Action => a !== null)
          : [];
        setData({
          ok: r.ok === true,
          total: num(r.total),
          stages: (typeof r.stages === "object" && r.stages !== null ? r.stages : {}) as Partial<Record<Stage, number>>,
          actions,
        });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load."))
      .finally(() => setLoading(false));
  }, []);

  const maxImpact = data ? Math.max(1, ...data.actions.map((a) => a.impact)) : 1;

  return (
    <Shell>
      <div className="grid gap-5">
        <div>
          <h1 className="text-2xl font-semibold">Money this week</h1>
          <p className="mt-1 text-sm text-ink/70">
            Ranked revenue actions over your live base — rules pick the move, you pick what to ship.
          </p>
        </div>

        {error ? <ErrorState message={error} /> : null}
        {loading ? <p className="text-sm text-ink/60">Loading…</p> : null}

        {data && data.total > 0 ? (
          <p className="text-sm text-ink/70">
            {data.total.toLocaleString()} profiles ·{" "}
            {Object.entries(data.stages)
              .filter(([, n]) => num(n) > 0)
              .map(([s, n]) => `${num(n).toLocaleString()} ${s}`)
              .join(" · ")}
          </p>
        ) : null}

        {data && data.actions.length > 0 ? (
          <div className="grid gap-3">
            {data.actions.map((a, i) => (
              <Panel key={a.key}>
                <div className="flex items-start justify-between gap-4">
                  <div className="grid gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-ink/40">#{i + 1}</span>
                      <h2 className="font-semibold">{a.title}</h2>
                    </div>
                    <p className="text-sm text-ink/70">{a.rationale}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge tone="ok">{CHANNEL_LABEL[a.channel] ?? a.channel}</Badge>
                      <Badge tone="neutral">{a.stage}</Badge>
                      <span className="text-sm text-ink/60">
                        {a.audienceSize.toLocaleString()} people
                      </span>
                    </div>
                  </div>
                  <div className="w-32 shrink-0 text-right">
                    <div className="text-xs text-ink/50">impact</div>
                    <div className="text-lg font-semibold tabular-nums">
                      {Math.round(a.impact).toLocaleString()}
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded bg-field">
                      <div
                        className="h-1.5 rounded bg-accent"
                        style={{ width: `${Math.max(4, (a.impact / maxImpact) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </Panel>
            ))}
          </div>
        ) : !loading && !error ? (
          <EmptyState
            title="No actions yet"
            body="Once your base has lifecycle stages with members, ranked actions appear here."
          />
        ) : null}
      </div>
    </Shell>
  );
}
