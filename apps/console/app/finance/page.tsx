"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  DEMO,
  DEMO_DDS_INPUT,
  DEMO_LOCATIONS,
  DEMO_MONTHS,
  DEMO_PNL_INPUT,
  computeDds,
  computeLocations,
  computePnl,
  pct,
  rub,
} from "../../src/finance";
import { Badge, MetricCard, PageHeader, Panel, Shell } from "../../src/ui";

type Tab = "overview" | "dds" | "pnl" | "locations";

const TABS: readonly { readonly key: Tab; readonly label: string }[] = [
  { key: "overview", label: "Обзор" },
  { key: "dds", label: "ОДДС" },
  { key: "pnl", label: "ОПиУ" },
  { key: "locations", label: "Магазины" },
];

export default function FinancePage() {
  const [tab, setTab] = useState<Tab>("overview");

  const dds = useMemo(() => computeDds(DEMO_DDS_INPUT), []);
  const pnl = useMemo(() => computePnl(DEMO_PNL_INPUT), []);
  const locs = useMemo(() => computeLocations(DEMO_LOCATIONS), []);

  // advice-сигнал: месяцы с отрицательным операционным потоком → риск кассового разрыва
  const gapMonths = dds
    .map((m, i) => ({ i, m }))
    .filter((x) => x.m.operatingTotal < 0)
    .map((x) => DEMO_MONTHS[x.i]?.label ?? "");

  const lastMonth = DEMO_MONTHS.length - 1;

  return (
    <Shell>
      <div className="grid gap-5">
        <PageHeader
          eyebrow="Финансовый учёт · XRM"
          title="Финансовый учёт"
          body="Управленческий учёт по данным воронки: ОДДС, ОПиУ, разрезы. Цифры считаются автоматически из выручки (CDP) и движения денег (1С:Деньги) — ручной ввод сведён к минимуму."
          actions={<Badge tone="info">методика: МаркФинансист + стандарты</Badge>}
        />

        {DEMO ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <b>Демо-данные (плейсхолдер).</b> Это каркас раздела на заглушечных цифрах. Реальные значения
            подставляются из выгрузки фин.данных тенанта «Олимп бизнес». Производные строки (маржинальная/чистая
            прибыль, рентабельности, итоги потоков, деньги на конец) уже считаются автоматически из базовых входов.
          </div>
        ) : null}

        {gapMonths.length ? (
          <Panel className="border-amber-200 bg-amber-50/60">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-amber-300 bg-amber-100 text-sm font-semibold text-amber-900">!</span>
              <div>
                <p className="text-sm font-semibold text-ink">Сигнал: риск кассового разрыва</p>
                <p className="mt-1 text-sm text-muted">
                  Операционный денежный поток отрицательный в: <b>{gapMonths.join(", ")}</b>. Это ранний признак
                  кассового разрыва — операционка не покрывает выплаты. Первый шаг: проверить вывод средств и
                  ускорить сбор дебиторки.
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
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label={`Выручка · ${DEMO_MONTHS[lastMonth]?.label}`} value={rub(pnl[lastMonth]?.revenue ?? 0)} detail="нетто, без НДС" tone="info" />
            <MetricCard label="Рентабельность маржи" value={pct(pnl[lastMonth]?.marginRatio ?? 0)} detail="маржинальная ÷ выручка" tone="ok" />
            <MetricCard label="Чистая прибыль" value={rub(pnl[lastMonth]?.net ?? 0)} detail={`рент. ${pct(pnl[lastMonth]?.netRatio ?? 0)}`} tone={(pnl[lastMonth]?.net ?? 0) >= 0 ? "ok" : "hot"} />
            <MetricCard label="Деньги на конец" value={rub(dds[lastMonth]?.cashEnd ?? 0)} detail="сверка с остатком по счетам" tone="neutral" />
          </div>
        ) : null}

        {tab === "dds" ? <DdsTable rows={dds} /> : null}
        {tab === "pnl" ? <PnlTable rows={pnl} /> : null}
        {tab === "locations" ? <LocationsTable rows={locs} /> : null}
      </div>
    </Shell>
  );
}

function Th(props: { readonly children: ReactNode; readonly right?: boolean }) {
  return <th className={`whitespace-nowrap px-3 py-2 text-xs font-medium uppercase text-muted ${props.right ? "text-right" : "text-left"}`}>{props.children}</th>;
}
function Num(props: { readonly v: number; readonly bold?: boolean; readonly neg?: boolean }) {
  const negative = props.neg ?? props.v < 0;
  return <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${props.bold ? "font-semibold text-ink" : "text-ink"} ${negative ? "text-red-700" : ""}`}>{rub(props.v)}</td>;
}
function RowLabel(props: { readonly children: ReactNode; readonly strong?: boolean }) {
  return <td className={`whitespace-nowrap px-3 py-2 ${props.strong ? "font-semibold text-ink" : "text-muted"}`}>{props.children}</td>;
}
function TableWrap(props: { readonly children: ReactNode }) {
  return (
    <Panel className="overflow-x-auto p-0">
      <table className="w-full border-collapse text-sm">{props.children}</table>
    </Panel>
  );
}

function MonthHead() {
  return (
    <tr className="border-b border-line bg-field/60">
      <Th>Статья</Th>
      {DEMO_MONTHS.map((m) => (
        <Th key={m.key} right>{m.label}</Th>
      ))}
    </tr>
  );
}

function DdsTable(props: { readonly rows: ReturnType<typeof computeDds> }) {
  const r = props.rows;
  return (
    <TableWrap>
      <thead><MonthHead /></thead>
      <tbody>
        <tr className="border-b border-line"><RowLabel>Деньги на начало</RowLabel>{r.map((m, i) => <Num key={i} v={m.cashStart} />)}</tr>
        <tr className="border-b border-line bg-emerald-50/40"><RowLabel strong>Операционный поток — итого</RowLabel>{r.map((m, i) => <Num key={i} v={m.operatingTotal} bold neg={m.operatingTotal < 0} />)}</tr>
        <tr className="border-b border-line"><RowLabel>— Поступления по осн. деятельности</RowLabel>{r.map((m, i) => <Num key={i} v={m.opInflow} />)}</tr>
        <tr className="border-b border-line"><RowLabel>— Переменные расходы</RowLabel>{r.map((m, i) => <Num key={i} v={m.opVariable} />)}</tr>
        <tr className="border-b border-line"><RowLabel>— Постоянные расходы</RowLabel>{r.map((m, i) => <Num key={i} v={m.opFixed} />)}</tr>
        <tr className="border-b border-line"><RowLabel strong>Инвестиционный поток — итого</RowLabel>{r.map((m, i) => <Num key={i} v={m.investing} bold />)}</tr>
        <tr className="border-b border-line"><RowLabel strong>Финансовый поток — итого</RowLabel>{r.map((m, i) => <Num key={i} v={m.financing} bold />)}</tr>
        <tr className="border-b border-line bg-field/40"><RowLabel strong>Итого движение денег</RowLabel>{r.map((m, i) => <Num key={i} v={m.total} bold />)}</tr>
        <tr><RowLabel strong>Деньги на конец</RowLabel>{r.map((m, i) => <Num key={i} v={m.cashEnd} bold />)}</tr>
      </tbody>
    </TableWrap>
  );
}

function PnlTable(props: { readonly rows: ReturnType<typeof computePnl> }) {
  const r = props.rows;
  return (
    <TableWrap>
      <thead><MonthHead /></thead>
      <tbody>
        <tr className="border-b border-line"><RowLabel strong>Выручка (нетто)</RowLabel>{r.map((m, i) => <Num key={i} v={m.revenue} bold />)}</tr>
        <tr className="border-b border-line"><RowLabel>Переменные расходы</RowLabel>{r.map((m, i) => <Num key={i} v={-m.variable} />)}</tr>
        <tr className="border-b border-line bg-emerald-50/40"><RowLabel strong>Маржинальная прибыль</RowLabel>{r.map((m, i) => <Num key={i} v={m.marginal} bold />)}</tr>
        <tr className="border-b border-line"><RowLabel>Рентабельность маржи</RowLabel>{r.map((m, i) => <td key={i} className="px-3 py-2 text-right tabular-nums text-muted">{pct(m.marginRatio)}</td>)}</tr>
        <tr className="border-b border-line"><RowLabel>Постоянные расходы</RowLabel>{r.map((m, i) => <Num key={i} v={-m.fixed} />)}</tr>
        <tr className="border-b border-line bg-field/40"><RowLabel strong>EBITDA (операционная)</RowLabel>{r.map((m, i) => <Num key={i} v={m.ebitda} bold />)}</tr>
        <tr className="border-b border-line"><RowLabel>Амортизация</RowLabel>{r.map((m, i) => <Num key={i} v={-m.amort} />)}</tr>
        <tr className="border-b border-line"><RowLabel>Проценты по кредитам</RowLabel>{r.map((m, i) => <Num key={i} v={-m.interest} />)}</tr>
        <tr className="border-b border-line"><RowLabel>Налог (по режиму)</RowLabel>{r.map((m, i) => <Num key={i} v={-m.tax} />)}</tr>
        <tr className="border-b border-line bg-emerald-50/40"><RowLabel strong>Чистая прибыль</RowLabel>{r.map((m, i) => <Num key={i} v={m.net} bold neg={m.net < 0} />)}</tr>
        <tr><RowLabel>Рентабельность чистой</RowLabel>{r.map((m, i) => <td key={i} className={`px-3 py-2 text-right tabular-nums ${m.net < 0 ? "text-red-700" : "text-muted"}`}>{pct(m.netRatio)}</td>)}</tr>
      </tbody>
    </TableWrap>
  );
}

function LocationsTable(props: { readonly rows: ReturnType<typeof computeLocations> }) {
  return (
    <TableWrap>
      <thead>
        <tr className="border-b border-line bg-field/60">
          <Th>Точка</Th><Th right>Выручка</Th><Th right>Маржин. прибыль</Th><Th right>Рент. маржи</Th>
          <Th right>EBITDA</Th><Th right>Выручка/аренда</Th><Th right>Выручка/ФОТ</Th>
        </tr>
      </thead>
      <tbody>
        {props.rows.map((m, i) => {
          const weakRent = m.revPerRent < 3;
          return (
            <tr className="border-b border-line" key={i}>
              <RowLabel strong>{m.name}</RowLabel>
              <Num v={m.revenue} />
              <Num v={m.marginal} />
              <td className="px-3 py-2 text-right tabular-nums text-muted">{pct(m.marginRatio)}</td>
              <Num v={m.ebitda} neg={m.ebitda < 0} />
              <td className={`px-3 py-2 text-right tabular-nums ${weakRent ? "bg-amber-50 font-semibold text-amber-900" : "text-ink"}`}>{m.revPerRent.toFixed(1).replace(".", ",")}</td>
              <td className="px-3 py-2 text-right tabular-nums text-ink">{m.revPerFot.toFixed(1).replace(".", ",")}</td>
            </tr>
          );
        })}
      </tbody>
    </TableWrap>
  );
}
