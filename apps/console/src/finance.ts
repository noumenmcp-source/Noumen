// Финансовый учёт — модель данных раздела.
// Структуры соответствуют чертежу docs/xrm-revenue-kb/04-table-structures-watch.md.
//
// Источник данных — РЕАЛЬНЫЙ: выгрузка продаж Ozon тенанта «Олимп бизнес»
// (src/finance-olymp.json, сгенерирован из ozon_orders.xlsx, 36 899 доставленных заказов).
// Это «половина воронки» (продажи): выручка и комиссия маркетплейса — фактические.
// Закупочная себестоимость, операционные расходы и банковский ДДС — из 1С (не подключены) —
// честно помечено в UI. Никаких выдуманных цифр под видом реальных.
//
// Производные (комиссия %, payout, маржа после Ozon, доли) СЧИТАЮТСЯ из фактических строк —
// демонстрация тезиса «цифры считаются, не вводятся руками».

import raw from "./finance-olymp.json";

export interface OlympMeta {
  readonly source: string;
  readonly status_filter: string;
  readonly range: string;
  readonly note: string;
}
export interface MonthRow {
  readonly key: string;
  readonly label: string;
  readonly revenue: number; // выручка gross (цена продажи), ₽
  readonly commission: number; // комиссия Ozon (отрицательная), ₽
  readonly payout: number; // выплата Олимпу = выручка после маркетплейса, ₽
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

const data = raw as { readonly meta: OlympMeta; readonly months: readonly MonthRow[]; readonly offers: readonly OfferRow[] };

export const OLYMP_META: OlympMeta = data.meta;
export const MONTHS: readonly MonthRow[] = data.months;
export const OFFERS: readonly OfferRow[] = data.offers;

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

// Тренд роста комиссии: сравнить первый и последний месяц окна.
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
