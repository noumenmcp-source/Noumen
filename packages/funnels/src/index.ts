/** @example const step: FunnelStep = { name: "Signup", eventName: "Signed Up" }; */
export type FunnelStep = Readonly<{ name: string; eventName: string }>;

/** @example const def: FunnelDefinition = { steps: [{ name: "Signup", eventName: "Signed Up" }] }; */
export type FunnelDefinition = Readonly<{ steps: readonly FunnelStep[]; windowMs?: number }>;

/** @example const row: FunnelRow = { subject: "u1", eventName: "Signed Up", ts: "2026-01-01T00:00:00.000Z" }; */
export type FunnelRow = Readonly<{ subject: string; eventName: string; ts: string }>;

/** @example const result: FunnelResult = { steps: [], subjects: 0 }; */
export type FunnelResult = Readonly<{ steps: readonly FunnelStepResult[]; subjects: number; medianTimeToConvertMs?: number }>;

/** @example const step: FunnelStepResult = { name: "Signup", reached: 1, conversionFromPrev: 1, conversionFromStart: 1 }; */
export type FunnelStepResult = Readonly<{ name: string; reached: number; conversionFromPrev: number; conversionFromStart: number }>;

/** @example const result = analyzeFunnel(rows, definition); */
export function analyzeFunnel(rows: readonly FunnelRow[], def: FunnelDefinition): FunnelResult {
  const subjects = groupRows(rows);
  const reached = def.steps.map(() => 0);
  const durations: number[] = [];
  for (const subjectRows of subjects.values()) {
    const progress = subjectProgress(subjectRows, def);
    for (let index = 0; index < progress.reached; index += 1) reached[index] += 1;
    if (progress.durationMs !== undefined) durations.push(progress.durationMs);
  }
  const steps = def.steps.map((step, index) => stepResult(step.name, reached, index));
  return { steps, subjects: subjects.size, medianTimeToConvertMs: median(durations) };
}

/** @example const losses = dropoff(result); */
export function dropoff(result: FunnelResult): readonly { readonly step: string; readonly lost: number }[] {
  return result.steps.slice(1).map((step, index) => ({ step: step.name, lost: result.steps[index].reached - step.reached }));
}

function groupRows(rows: readonly FunnelRow[]): Map<string, readonly FunnelRow[]> {
  const map = new Map<string, FunnelRow[]>();
  for (const row of rows) map.set(row.subject, [...(map.get(row.subject) ?? []), row]);
  for (const [subject, value] of map) map.set(subject, [...value].sort(compareRows));
  return map;
}

function subjectProgress(rows: readonly FunnelRow[], def: FunnelDefinition): { readonly reached: number; readonly durationMs?: number } {
  let stepIndex = 0;
  let firstTs: number | undefined;
  let lastTs: number | undefined;
  for (const row of rows) {
    if (row.eventName !== def.steps[stepIndex]?.eventName) continue;
    const ts = Date.parse(row.ts);
    if (firstTs !== undefined && def.windowMs !== undefined && ts - firstTs > def.windowMs) continue;
    firstTs ??= ts;
    lastTs = ts;
    stepIndex += 1;
    if (stepIndex === def.steps.length) break;
  }
  return { reached: stepIndex, durationMs: duration(def.steps.length, stepIndex, firstTs, lastTs) };
}

function stepResult(name: string, reached: readonly number[], index: number): FunnelStepResult {
  const fromPrevBase = index === 0 ? reached[0] : reached[index - 1];
  return { name, reached: reached[index], conversionFromPrev: ratio(reached[index], fromPrevBase), conversionFromStart: ratio(reached[index], reached[0]) };
}

function duration(totalSteps: number, reached: number, firstTs: number | undefined, lastTs: number | undefined): number | undefined {
  return reached === totalSteps && firstTs !== undefined && lastTs !== undefined ? lastTs - firstTs : undefined;
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function ratio(value: number, base: number): number {
  return base === 0 ? 0 : value / base;
}

function compareRows(a: FunnelRow, b: FunnelRow): number {
  return Date.parse(a.ts) - Date.parse(b.ts) || a.eventName.localeCompare(b.eventName);
}
