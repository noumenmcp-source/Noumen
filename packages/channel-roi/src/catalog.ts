import type { CanonicalChannel, ChannelRoi } from "./types.js";

/** Owner-facing, plain-language naming for a metric — the "explain" layer baked
 * into the metric definition itself, so the AI narrative cites a canonical text
 * rather than improvising. */
export interface MetricExplanation {
  readonly plainName: string;
  readonly ownerText: string;
}

export type MetricUnit = "ratio" | "currency" | "months" | "percent" | "count";

/** A semantic metric definition: formula, grain, sources, and its explanation.
 * Product copy is English (US clients); `localized` carries other locales. */
export interface MetricDefinition {
  readonly metric: string;
  readonly definition: string;
  readonly grain: readonly string[];
  readonly sourceTables: readonly string[];
  readonly unit: MetricUnit;
  readonly goodDirection: "up" | "down";
  readonly explanation: MetricExplanation;
  readonly localized?: Readonly<Record<string, MetricExplanation>>;
}

const ACCOUNT_GRAIN = ["account_id", "channel", "campaign", "day"] as const;

export const METRIC_CATALOG: readonly MetricDefinition[] = [
  {
    metric: "ad_spend",
    definition: "sum(spend)",
    grain: [...ACCOUNT_GRAIN],
    sourceTables: ["ad_spend_daily"],
    unit: "currency",
    goodDirection: "down",
    explanation: { plainName: "Ad spend", ownerText: "How much you paid the ad platforms." },
    localized: { ru: { plainName: "Рекламный бюджет", ownerText: "Сколько вы заплатили рекламным платформам." } },
  },
  {
    metric: "attributed_revenue",
    definition: "sum(revenue) credited to the channel by the attribution model",
    grain: [...ACCOUNT_GRAIN],
    sourceTables: ["attributed_revenue_daily"],
    unit: "currency",
    goodDirection: "up",
    explanation: { plainName: "Revenue from this channel", ownerText: "Sales the attribution model credits to this channel." },
    localized: { ru: { plainName: "Выручка с канала", ownerText: "Продажи, которые модель атрибуции приписывает этому каналу." } },
  },
  {
    metric: "channel_roas",
    definition: "attributed_revenue / ad_spend",
    grain: [...ACCOUNT_GRAIN],
    sourceTables: ["ad_spend_daily", "attributed_revenue_daily"],
    unit: "ratio",
    goodDirection: "up",
    explanation: { plainName: "Ad payback (ROAS)", ownerText: "How many dollars of revenue each ad dollar brought back." },
    localized: { ru: { plainName: "окупаемость рекламы", ownerText: "Сколько долларов выручки вернул каждый доллар рекламы." } },
  },
  {
    metric: "channel_cpa",
    definition: "ad_spend / conversions",
    grain: [...ACCOUNT_GRAIN],
    sourceTables: ["ad_spend_daily", "attributed_revenue_daily"],
    unit: "currency",
    goodDirection: "down",
    explanation: { plainName: "Cost per action", ownerText: "What you pay, on average, for one conversion." },
    localized: { ru: { plainName: "цена действия", ownerText: "Сколько в среднем стоит одна конверсия." } },
  },
  {
    metric: "channel_cac",
    definition: "ad_spend / new_customers",
    grain: [...ACCOUNT_GRAIN],
    sourceTables: ["ad_spend_daily", "attributed_revenue_daily"],
    unit: "currency",
    goodDirection: "down",
    explanation: { plainName: "Cost to win a customer", ownerText: "What you spend on ads to get one new paying customer." },
    localized: { ru: { plainName: "цена клиента", ownerText: "Сколько рекламы тратится на одного нового платящего клиента." } },
  },
  {
    metric: "channel_payback_months",
    definition: "channel_cac / monthly_gross_profit_per_customer",
    grain: ["account_id", "channel", "month"],
    sourceTables: ["ad_spend_daily", "attributed_revenue_daily"],
    unit: "months",
    goodDirection: "down",
    explanation: { plainName: "Payback time", ownerText: "How many months a customer needs to earn back what you paid to acquire them." },
    localized: { ru: { plainName: "срок окупаемости", ownerText: "За сколько месяцев клиент окупает то, что вы заплатили за его привлечение." } },
  },
  {
    metric: "channel_profit",
    definition: "attributed_revenue - ad_spend",
    grain: [...ACCOUNT_GRAIN],
    sourceTables: ["ad_spend_daily", "attributed_revenue_daily"],
    unit: "currency",
    goodDirection: "up",
    explanation: { plainName: "Channel profit", ownerText: "Money left after paying for the ads on this channel." },
    localized: { ru: { plainName: "прибыль канала", ownerText: "Сколько остаётся после оплаты рекламы на этом канале." } },
  },
];

const BY_NAME: ReadonlyMap<string, MetricDefinition> = new Map(METRIC_CATALOG.map((m) => [m.metric, m]));

export function getMetric(name: string): MetricDefinition | undefined {
  return BY_NAME.get(name);
}

/** Resolve a metric's explanation in a locale, falling back to canonical (en). */
export function explain(name: string, locale = "en"): MetricExplanation | undefined {
  const def = BY_NAME.get(name);
  if (!def) return undefined;
  return locale === "en" ? def.explanation : def.localized?.[locale] ?? def.explanation;
}

/**
 * Facts for one channel keyed by catalog metric name — the grounded inputs a
 * "why" narrative must cite (never a number the model invented).
 */
export function channelMetricFacts(roi: ChannelRoi): Readonly<Record<string, number>> {
  return {
    ad_spend: roi.spend,
    attributed_revenue: roi.revenue,
    channel_roas: roi.roas,
    channel_cpa: roi.cpa,
    channel_cac: roi.cac,
    channel_profit: roi.profit,
  };
}

export type { CanonicalChannel };
