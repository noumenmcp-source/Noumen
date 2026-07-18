// Финансовый учёт — модель данных раздела.
// Структуры соответствуют чертежу docs/xrm-revenue-kb/04-table-structures-watch.md
// (ОДДС / ОПиУ / ОПУ-магазины), снятому покадрово с рабочих таблиц финдира.
//
// ВАЖНО (honesty-дисциплина north-star): значения в DEMO_* — заглушки-плейсхолдеры,
// НЕ реальные данные тенанта. Заменяются выгрузкой фин.данных тенанта «Олимп бизнес».
// Производные строки (маржинальная/чистая прибыль, рентабельности, итоги потоков,
// деньги на конец) СЧИТАЮТСЯ из базовых входов — демонстрация тезиса «−80% ручного ввода».

export const DEMO = true;

export type Money = number; // рубли

export interface MonthCol {
  readonly key: string;
  readonly label: string;
}

// ── ОДДС (движение денежных средств), помесячно, три потока ──────────────────
export interface DdsInput {
  readonly cashStart: Money; // деньги на начало (только для первого месяца; далее чейнится)
  readonly opInflow: Money; // поступления по осн. деятельности
  readonly opVariable: Money; // выбытия — переменные расходы (отрицательные)
  readonly opFixed: Money; // выбытия — постоянные расходы (отрицательные)
  readonly investing: Money; // инвестиционный поток (итог)
  readonly financing: Money; // финансовый поток (итог)
}

export interface DdsMonth extends DdsInput {
  readonly operatingTotal: Money; // = opInflow + opVariable + opFixed
  readonly total: Money; // = operating + investing + financing
  readonly cashEnd: Money; // = cashStart + total
}

export function computeDds(inputs: readonly DdsInput[]): readonly DdsMonth[] {
  let carry = inputs.length ? inputs[0].cashStart : 0;
  return inputs.map((m, i) => {
    const cashStart = i === 0 ? m.cashStart : carry;
    const operatingTotal = m.opInflow + m.opVariable + m.opFixed;
    const total = operatingTotal + m.investing + m.financing;
    const cashEnd = cashStart + total;
    carry = cashEnd;
    return { ...m, cashStart, operatingTotal, total, cashEnd };
  });
}

// ── ОПиУ (отчёт о прибылях и убытках), помесячно ─────────────────────────────
export interface PnlInput {
  readonly revenue: Money; // выручка нетто (без НДС)
  readonly variable: Money; // переменные расходы (положительное число)
  readonly fixed: Money; // постоянные расходы
  readonly amort: Money; // амортизация
  readonly interest: Money; // проценты по кредитам
  readonly tax: Money; // налог по режиму
}

export interface PnlMonth extends PnlInput {
  readonly marginal: Money; // = revenue − variable
  readonly marginRatio: number; // marginal / revenue
  readonly ebitda: Money; // = revenue − variable − fixed  (операционная до аморт/%/налога)
  readonly net: Money; // = ebitda − amort − interest − tax
  readonly netRatio: number; // net / revenue
}

export function computePnl(inputs: readonly PnlInput[]): readonly PnlMonth[] {
  return inputs.map((m) => {
    const marginal = m.revenue - m.variable;
    const ebitda = marginal - m.fixed;
    const net = ebitda - m.amort - m.interest - m.tax;
    return {
      ...m,
      marginal,
      marginRatio: m.revenue ? marginal / m.revenue : 0,
      ebitda,
      net,
      netRatio: m.revenue ? net / m.revenue : 0,
    };
  });
}

// ── ОПУ магазины (P&L по точкам) ─────────────────────────────────────────────
export interface LocationInput {
  readonly name: string;
  readonly revenue: Money;
  readonly variable: Money;
  readonly fixed: Money;
  readonly rent: Money; // аренда (входит в fixed, вынесена для коэффициента)
  readonly fot: Money; // ФОТ (входит в fixed, вынесен для коэффициента)
}

export interface LocationRow extends LocationInput {
  readonly marginal: Money;
  readonly marginRatio: number;
  readonly ebitda: Money; // = revenue − variable − fixed
  readonly revPerRent: number; // выручка/аренда (больше = лучше)
  readonly revPerFot: number; // выручка/ФОТ
}

export function computeLocations(inputs: readonly LocationInput[]): readonly LocationRow[] {
  return inputs.map((m) => {
    const marginal = m.revenue - m.variable;
    const ebitda = marginal - m.fixed;
    return {
      ...m,
      marginal,
      marginRatio: m.revenue ? marginal / m.revenue : 0,
      ebitda,
      revPerRent: m.rent ? m.revenue / m.rent : 0,
      revPerFot: m.fot ? m.revenue / m.fot : 0,
    };
  });
}

// ── Форматирование ───────────────────────────────────────────────────────────
export function rub(v: Money): string {
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(Math.round(v));
  return `${sign}${abs.toLocaleString("ru-RU")}`;
}

export function pct(v: number): string {
  return `${(v * 100).toFixed(1).replace(".", ",")}%`;
}

// ── DEMO-датасет (плейсхолдер, заменить выгрузкой «Олимп бизнес») ─────────────
export const DEMO_MONTHS: readonly MonthCol[] = [
  { key: "jan", label: "Январь" },
  { key: "feb", label: "Февраль" },
  { key: "mar", label: "Март" },
  { key: "apr", label: "Апрель" },
  { key: "may", label: "Май" },
  { key: "jun", label: "Июнь" },
];

export const DEMO_DDS_INPUT: readonly DdsInput[] = [
  { cashStart: 1_200_000, opInflow: 4_100_000, opVariable: -2_460_000, opFixed: -1_180_000, investing: -120_000, financing: -140_000 },
  { cashStart: 0, opInflow: 3_760_000, opVariable: -2_180_000, opFixed: -1_190_000, investing: 0, financing: -140_000 },
  { cashStart: 0, opInflow: 3_050_000, opVariable: -1_930_000, opFixed: -1_205_000, investing: -60_000, financing: -140_000 },
  { cashStart: 0, opInflow: 2_640_000, opVariable: -1_760_000, opFixed: -1_215_000, investing: 0, financing: -140_000 }, // операционка в минусе → сигнал
  { cashStart: 0, opInflow: 3_320_000, opVariable: -2_010_000, opFixed: -1_190_000, investing: 0, financing: -140_000 },
  { cashStart: 0, opInflow: 3_880_000, opVariable: -2_290_000, opFixed: -1_180_000, investing: -40_000, financing: -140_000 },
];

export const DEMO_PNL_INPUT: readonly PnlInput[] = [
  { revenue: 4_050_000, variable: 2_460_000, fixed: 1_180_000, amort: 60_000, interest: 40_000, tax: 243_000 },
  { revenue: 3_620_000, variable: 2_180_000, fixed: 1_190_000, amort: 60_000, interest: 38_000, tax: 217_000 },
  { revenue: 3_010_000, variable: 1_930_000, fixed: 1_205_000, amort: 60_000, interest: 36_000, tax: 181_000 },
  { revenue: 2_580_000, variable: 1_760_000, fixed: 1_215_000, amort: 60_000, interest: 35_000, tax: 155_000 },
  { revenue: 3_260_000, variable: 2_010_000, fixed: 1_190_000, amort: 60_000, interest: 34_000, tax: 196_000 },
  { revenue: 3_840_000, variable: 2_290_000, fixed: 1_180_000, amort: 60_000, interest: 33_000, tax: 230_000 },
];

export const DEMO_LOCATIONS: readonly LocationInput[] = [
  { name: "Новосибирск", revenue: 4_600_000, variable: 1_320_000, fixed: 2_380_000, rent: 640_000, fot: 510_000 },
  { name: "Москва, Б.Полянка", revenue: 3_176_000, variable: 940_000, fixed: 1_980_000, rent: 720_000, fot: 480_000 },
  { name: "Афимолл, Москва", revenue: 2_550_000, variable: 780_000, fixed: 2_120_000, rent: 960_000, fot: 470_000 }, // аренда убивает
  { name: "Галерея, СПб", revenue: 3_034_000, variable: 900_000, fixed: 1_870_000, rent: 690_000, fot: 460_000 },
  { name: "Сайт", revenue: 1_739_000, variable: 610_000, fixed: 520_000, rent: 40_000, fot: 260_000 },
  { name: "Маркетплейсы", revenue: 7_136_000, variable: 3_980_000, fixed: 1_240_000, rent: 60_000, fot: 380_000 },
];
