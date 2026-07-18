"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  MONTHS,
  OFFERS,
  OLYMP_META,
  avgCheck,
  commissionPct,
  commissionTrend,
  payoutPct,
  pct,
  rub,
  sumMonths,
  type MonthRow,
  type OfferRow,
} from "../../src/finance";
import { Badge, MetricCard, PageHeader, Panel, Shell } from "../../src/ui";

type Tab = "overview" | "pnl" | "offers";

const TABS: readonly { readonly key: Tab; readonly label: string }[] = [
  { key: "overview", label: "Обзор" },
  { key: "pnl", label: "Выручка (ОПиУ)" },
  { key: "offers", label: "Товары" },
];

export default function FinancePage() {
  const [tab, setTab] = useState<Tab>("overview");
  const months = MONTHS;
  const last = months[months.length - 1];
  const totals = useMemo(() => sumMonths(months), [months]);
  const trend = useMemo(() => commissionTrend(months), [months]);

  return (
    <Shell>
      <div className="grid gap-5">
        <PageHeader
          eyebrow="Финансовый учёт · Олимп бизнес"
          title="Финансовый учёт"
          body="Управленческий учёт по данным воронки. Выручка и комиссия маркетплейса — из фактических продаж Ozon; производные показатели считаются автоматически."
          actions={<Badge tone="ok">данные: реальные (Ozon)</Badge>}
        />

        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          <b>Источник:</b> {OLYMP_META.source}. Период: {OLYMP_META.range}. {OLYMP_META.note}
        </div>

        {trend.deltaPp > 5 ? (
          <Panel className="border-amber-200 bg-amber-50/60">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-amber-300 bg-amber-100 text-sm font-semibold text-amber-900">!</span>
              <div>
                <p className="text-sm font-semibold text-ink">Сигнал: маркетплейс забирает всё больше</p>
                <p className="mt-1 text-sm text-muted">
                  Комиссия Ozon выросла с <b>{pct(trend.first)}</b> до <b>{pct(trend.last)}</b> выручки
                  (+{trend.deltaPp.toFixed(1).replace(".", ",")} п.п. за период). Выплата Олимпу проседает при той же
                  выручке. Первый шаг: пересчитать цены/ассортимент под новую комиссию, усилить прямой канал (сайт).
                </p>
              </div>
            </div>
          </Panel>
        ) : null}

        <nav className="flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              className={`navlink shrink-0 ${tab === t.key ? "navlink-active" : ""}`}
              key={t.key}
              onClick={() => setTab(t.key)}
              type="button"
            >
              {t.label}
            </button>
          ))}
        </nav>

        {tab === "overview" ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label={`Выручка · ${last?.label ?? ""}`} value={rub(last?.revenue ?? 0)} detail={`заказов: ${last?.orders ?? 0}`} tone="info" />
              <MetricCard label="Комиссия Ozon" value={pct(last ? commissionPct(last) : 0)} detail="доля выручки" tone="warm" />
              <MetricCard label="Выплата (после Ozon)" value={rub(last?.payout ?? 0)} detail={`${pct(last ? payoutPct(last) : 0)} выручки`} tone="ok" />
              <MetricCard label="Средний чек" value={rub(last ? avgCheck(last) : 0)} detail="выручка ÷ заказы" tone="neutral" />
            </div>
            <Panel>
              <p className="text-sm font-medium text-ink">Итого за период ({months.length} мес.)</p>
              <div className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><p className="text-muted">Выручка</p><p className="font-semibold text-ink">{rub(totals.revenue)}</p></div>
                <div><p className="text-muted">Комиссия Ozon</p><p className="font-semibold text-red-700">{rub(totals.commission)}</p></div>
                <div><p className="text-muted">Выплата</p><p className="font-semibold text-ink">{rub(totals.payout)}</p></div>
                <div><p className="text-muted">Заказов / штук</p><p className="font-semibold text-ink">{totals.orders.toLocaleString("ru-RU")} / {totals.units.toLocaleString("ru-RU")}</p></div>
              </div>
            </Panel>
          </>
        ) : null}

        {tab === "pnl" ? <PnlTable rows={months} /> : null}
        {tab === "offers" ? <OffersTable rows={OFFERS} /> : null}
      </div>
    </Shell>
  );
}

function Th(props: { readonly children: ReactNode; readonly right?: boolean }) {
  return <th className={`whitespace-nowrap px-3 py-2 text-xs font-medium uppercase text-muted ${props.right ? "text-right" : "text-left"}`}>{props.children}</th>;
}
function Cell(props: { readonly children: ReactNode; readonly bold?: boolean; readonly red?: boolean }) {
  return <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${props.bold ? "font-semibold text-ink" : props.red ? "text-red-700" : "text-ink"}`}>{props.children}</td>;
}
function TableWrap(props: { readonly children: ReactNode; readonly caption: string }) {
  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted">{props.caption}</p>
      <Panel className="overflow-x-auto p-0">
        <table className="w-full border-collapse text-sm">{props.children}</table>
      </Panel>
    </div>
  );
}

function PnlTable(props: { readonly rows: readonly MonthRow[] }) {
  return (
    <TableWrap caption="ОПиУ (Ozon-контур): выручка → минус комиссия маркетплейса → выплата. Закупочная себестоимость и опер.расходы — из 1С (не подключено).">
      <thead>
        <tr className="border-b border-line bg-field/60">
          <Th>Месяц</Th><Th right>Выручка</Th><Th right>Комиссия Ozon</Th><Th right>Комиссия %</Th>
          <Th right>Выплата</Th><Th right>Выплата %</Th><Th right>Заказы</Th>
        </tr>
      </thead>
      <tbody>
        {props.rows.map((m) => {
          const cpHigh = commissionPct(m) > 0.33;
          return (
            <tr className="border-b border-line" key={m.key}>
              <td className="whitespace-nowrap px-3 py-2 font-medium text-ink">{m.label}</td>
              <Cell bold>{rub(m.revenue)}</Cell>
              <Cell red>{rub(m.commission)}</Cell>
              <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${cpHigh ? "bg-amber-50 font-semibold text-amber-900" : "text-muted"}`}>{pct(commissionPct(m))}</td>
              <Cell bold>{rub(m.payout)}</Cell>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted">{pct(payoutPct(m))}</td>
              <Cell>{m.orders}</Cell>
            </tr>
          );
        })}
      </tbody>
    </TableWrap>
  );
}

function OffersTable(props: { readonly rows: readonly OfferRow[] }) {
  return (
    <TableWrap caption="Товарная аналитика (топ-15 по выручке): выручка, комиссия Ozon, выплата, маржа после маркетплейса. Полная маржа считается после подключения закупки (1С).">
      <thead>
        <tr className="border-b border-line bg-field/60">
          <Th>Товар</Th><Th right>Штук</Th><Th right>Выручка</Th><Th right>Комиссия %</Th><Th right>Выплата</Th><Th right>Маржа после Ozon</Th>
        </tr>
      </thead>
      <tbody>
        {props.rows.map((o, i) => {
          const cp = o.revenue ? Math.abs(o.commission) / o.revenue : 0;
          const mp = o.revenue ? o.payout / o.revenue : 0;
          return (
            <tr className="border-b border-line" key={i}>
              <td className="max-w-[22rem] truncate px-3 py-2 font-medium text-ink" title={o.name}>{o.name}</td>
              <Cell>{o.units.toLocaleString("ru-RU")}</Cell>
              <Cell bold>{rub(o.revenue)}</Cell>
              <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${cp > 0.33 ? "bg-amber-50 font-semibold text-amber-900" : "text-muted"}`}>{pct(cp)}</td>
              <Cell>{rub(o.payout)}</Cell>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-ink">{pct(mp)}</td>
            </tr>
          );
        })}
      </tbody>
    </TableWrap>
  );
}
