// Финансовый учёт — типы и помощники раздела.
// Данные приходят с API (/v1/tenants/:id/finance/summary). Встроенный снапшот
// (finance-olymp.json — реальный агрегат продаж Ozon тенанта «Олимп бизнес»,
// 36 899 доставленных заказов) используется как офлайн-фолбэк, если API недоступен.
//
// Honesty: это «половина воронки» (продажи) — выручка и комиссия маркетплейса
// фактические; закупочная себестоимость, опер.расходы и банковский ДДС — из 1С
// (не подключены), помечено в meta.note. Производные считаются из фактических строк.

import snapshot from "./finance-olymp.json";

export interface FinanceMeta {
  readonly source: string;
  readonly status_filter: string;
  readonly range: string;
  readonly note: string;
}
export interface MonthRow {
  readonly key: string;
  readonly label: string;
  readonly revenue: number;
  readonly commission: number;
  readonly payout: number;
  readonly orders: number;
  readonly units: number;
}
export interface OfferRow {
  readonly name: string;
  readonly units: number;
  readonly revenue: number;
  readonly commission: number;
  readonly payout: number;
}
export interface FinanceSummary {
  readonly meta: FinanceMeta | null;
  readonly months: readonly MonthRow[];
  readonly offers: readonly OfferRow[];
}

/** Офлайн-снапшот (реальный агрегат Олимпа) — фолбэк, когда API недоступен. */
export const SNAPSHOT: FinanceSummary = snapshot as FinanceSummary;

export function isEmpty(s: FinanceSummary | null): boolean {
  return !s || (s.months.length === 0 && s.offers.length === 0);
}

// ── Производные показатели ───────────────────────────────────────────────────
export function commissionPct(m: { readonly commission: number; readonly revenue: number }): number {
  return m.revenue ? Math.abs(m.commission) / m.revenue : 0;
}
export function payoutPct(m: { readonly payout: number; readonly revenue: number }): number {
  return m.revenue ? m.payout / m.revenue : 0;
}
export function avgCheck(m: MonthRow): number {
  return m.orders ? m.revenue / m.orders : 0;
}

export interface Totals {
  readonly revenue: number;
  readonly commission: number;
  readonly payout: number;
  readonly orders: number;
  readonly units: number;
}
export function sumMonths(rows: readonly MonthRow[]): Totals {
  return rows.reduce<Totals>(
    (a, m) => ({
      revenue: a.revenue + m.revenue,
      commission: a.commission + m.commission,
      payout: a.payout + m.payout,
      orders: a.orders + m.orders,
      units: a.units + m.units,
    }),
    { revenue: 0, commission: 0, payout: 0, orders: 0, units: 0 },
  );
}

export function commissionTrend(rows: readonly MonthRow[]): { readonly first: number; readonly last: number; readonly deltaPp: number } {
  if (rows.length < 2) return { first: 0, last: 0, deltaPp: 0 };
  const first = commissionPct(rows[0]);
  const last = commissionPct(rows[rows.length - 1]);
  return { first, last, deltaPp: (last - first) * 100 };
}

// ── Форматирование ───────────────────────────────────────────────────────────
export function rub(v: number): string {
  const sign = v < 0 ? "−" : "";
  return `${sign}${Math.abs(Math.round(v)).toLocaleString("ru-RU")}`;
}
export function pct(v: number): string {
  return `${(v * 100).toFixed(1).replace(".", ",")}%`;
}
