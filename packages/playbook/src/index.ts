import type { LifecycleStage } from "@cdp-us/computed-traits";

/**
 * @cdp-us/playbook — the "money this week" action engine (AXIOM deck slides 4/7).
 * Deterministic rules turn the lifecycle distribution of the base into a ranked
 * list of concrete revenue actions. Rules decide WHAT and WHO; LLM copy (Flot)
 * is a separate, downstream step that only fills in the message.
 */

/** Where the action is delivered. */
export type ActionChannel = "email" | "sms" | "task" | "ad_audience";

/** What kind of revenue move this is. */
export type ActionKind = "win_back" | "resell" | "chase_leads" | "exclude_junk" | "reactivate";

/** A single ranked, ready-to-ship action proposal. */
export type PlaybookAction = Readonly<{
  key: string;
  kind: ActionKind;
  title: string;
  stage: LifecycleStage;
  channel: ActionChannel;
  audienceSize: number;
  /** Relative opportunity = audienceSize × per-head weight (higher = do first). */
  impact: number;
  rationale: string;
}>;

export type PlaybookInput = Readonly<{
  stages: Readonly<Record<LifecycleStage, number>>;
  /** Max actions to return (deck: ~10 for the week). */
  limit?: number;
}>;

/**
 * One rule per revenue move. `weight` is the per-head opportunity multiplier:
 * winning back a dormant buyer is cheaper than acquiring new; junk only saves
 * ad spend. Tuned to be explainable, not learned.
 */
const RULES: ReadonlyArray<{
  kind: ActionKind;
  stage: LifecycleStage;
  channel: ActionChannel;
  weight: number;
  title: string;
  rationale: string;
}> = [
  { kind: "win_back", stage: "dormant", channel: "email", weight: 1, title: "Win back dormant 90+ days → email with an offer", rationale: "Cheaper to win back than to buy new." },
  { kind: "resell", stage: "vip", channel: "sms", weight: 0.9, title: "Resell to repeat VIPs → SMS", rationale: "Highest-LTV buyers; quick upsell." },
  { kind: "chase_leads", stage: "new", channel: "task", weight: 0.6, title: "Chase new unconverted signups → task for the rep", rationale: "Fresh intent slips without a human touch." },
  { kind: "reactivate", stage: "lost", channel: "email", weight: 0.4, title: "Re-activate lost customers → last-chance email", rationale: "Long-gone; lower yield but cheap to try." },
  { kind: "exclude_junk", stage: "junk", channel: "ad_audience", weight: 0.3, title: "Exclude junk from ads → suppression audience", rationale: "Stop paying to reach non-buyers." },
];

/**
 * Build the ranked weekly playbook from a lifecycle distribution.
 * Drops empty-audience actions; ranks by impact desc (tie-break by kind).
 *
 * @example generatePlaybook({ stages: { dormant: 417, junk: 1240, ... } });
 */
export function generatePlaybook(input: PlaybookInput): readonly PlaybookAction[] {
  const limit = input.limit ?? 10;
  return RULES.map((rule) => {
    const audienceSize = input.stages[rule.stage] ?? 0;
    return {
      key: `${rule.kind}_${rule.stage}`,
      kind: rule.kind,
      title: rule.title,
      stage: rule.stage,
      channel: rule.channel,
      audienceSize,
      impact: Math.round(audienceSize * rule.weight),
      rationale: rule.rationale,
    };
  })
    .filter((action) => action.audienceSize > 0)
    .sort((left, right) => right.impact - left.impact || left.kind.localeCompare(right.kind))
    .slice(0, limit);
}
