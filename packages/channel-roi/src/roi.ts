import type { CanonicalChannel, ChannelRoi, MarketingMetric, RevenueEvent, RoiOptions, RoiSummary } from "./types.js";

const round = (n: number): number => Math.round(n * 100) / 100;

/** revenue / spend; 0 when there is no spend (avoids Infinity). */
export function roas(revenue: number, spend: number): number {
  return spend > 0 ? round(revenue / spend) : 0;
}

/** spend / newCustomers; 0 when there are no new customers. */
export function cac(spend: number, newCustomers: number): number {
  return newCustomers > 0 ? round(spend / newCustomers) : 0;
}

/** spend / conversions; 0 when there are no conversions. */
export function cpa(spend: number, conversions: number): number {
  return conversions > 0 ? round(spend / conversions) : 0;
}

/** Months to recover CAC from a customer's monthly gross profit. 0 if no margin. */
export function paybackMonths(cacValue: number, monthlyGrossProfitPerCustomer: number): number {
  return monthlyGrossProfitPerCustomer > 0 ? round(cacValue / monthlyGrossProfitPerCustomer) : 0;
}

interface Acc {
  spend: number; revenue: number; conversions: number; newCustomers: number;
  clicks: number; impressions: number; currency: string;
}

/**
 * Join spend (MarketingMetric) with revenue (RevenueEvent) by canonical channel
 * and compute per-channel ROAS / CAC / CPA / profit / profitability — the core
 * the ROI translator narrates. `breakevenRoas` defaults to 1; pass `1/grossMargin`
 * for true profitability.
 * @example summarizeChannelRoi(metrics, revenue, { breakevenRoas: 1 / 0.8 })
 */
export function summarizeChannelRoi(
  metrics: readonly MarketingMetric[],
  revenue: readonly RevenueEvent[],
  opts: RoiOptions = {},
): RoiSummary {
  const breakeven = opts.breakevenRoas ?? 1;
  const acc = new Map<CanonicalChannel, Acc>();
  const get = (ch: CanonicalChannel, currency: string): Acc => {
    let a = acc.get(ch);
    if (!a) {
      a = { spend: 0, revenue: 0, conversions: 0, newCustomers: 0, clicks: 0, impressions: 0, currency };
      acc.set(ch, a);
    }
    return a;
  };

  for (const m of metrics) {
    const a = get(m.channel, m.currency);
    a.spend += m.spend;
    a.conversions += m.conversions;
    a.clicks += m.clicks;
    a.impressions += m.impressions;
  }
  for (const r of revenue) {
    const a = get(r.channel, r.currency);
    a.revenue += r.amount;
    if (r.isNewCustomer) a.newCustomers += 1;
  }

  const channels: ChannelRoi[] = [...acc.entries()]
    .map(([channel, a]): ChannelRoi => ({
      channel,
      spend: round(a.spend),
      revenue: round(a.revenue),
      conversions: a.conversions,
      newCustomers: a.newCustomers,
      clicks: a.clicks,
      impressions: a.impressions,
      roas: roas(a.revenue, a.spend),
      cac: cac(a.spend, a.newCustomers),
      cpa: cpa(a.spend, a.conversions),
      profit: round(a.revenue - a.spend),
      profitable: a.spend > 0 ? a.revenue / a.spend >= breakeven : a.revenue > 0,
      currency: a.currency,
    }))
    .sort((x, y) => y.spend - x.spend);

  const totals = channels.reduce(
    (t, c) => ({
      spend: t.spend + c.spend, revenue: t.revenue + c.revenue,
      conversions: t.conversions + c.conversions, newCustomers: t.newCustomers + c.newCustomers,
      profit: t.profit + c.profit,
    }),
    { spend: 0, revenue: 0, conversions: 0, newCustomers: 0, profit: 0 },
  );

  // Best/worst by ROAS among channels that actually spent.
  const spenders = channels.filter((c) => c.spend > 0);
  const byRoas = [...spenders].sort((a, b) => b.roas - a.roas);

  return {
    channels,
    totals: {
      spend: round(totals.spend), revenue: round(totals.revenue),
      conversions: totals.conversions, newCustomers: totals.newCustomers,
      roas: roas(totals.revenue, totals.spend),
      blendedCac: cac(totals.spend, totals.newCustomers),
      profit: round(totals.profit),
    },
    ...(byRoas.length ? { best: byRoas[0], worst: byRoas[byRoas.length - 1] } : {}),
  };
}
