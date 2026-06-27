/** @example const spec = parseCron("0 9 * * 1-5"); */
export type CronSpec = Readonly<{ expr: string; valid: boolean; issues: readonly string[]; fields: readonly CronField[] }>;

/** @example const field: CronField = { min: 0, max: 59, values: new Set([0]) }; */
export type CronField = Readonly<{ min: number; max: number; values: ReadonlySet<number> }>;

/** @example const interval: Interval = { everySeconds: 60 }; */
export type Interval = Readonly<{ everySeconds: number }>;

const RANGES = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
] as const;

/** @example const spec = parseCron("0,15,30,45 9-17 * * 1-5"); */
export function parseCron(expr: string): CronSpec {
  const tokens = expr.trim().split(/\s+/);
  if (tokens.length !== 5) return { expr, valid: false, issues: ["expected_5_fields"], fields: [] };
  const parsed = tokens.map((token, index) => parseField(token, RANGES[index][0], RANGES[index][1]));
  const issues = parsed.flatMap((field, index) => field.issue.map((issue) => `field_${index + 1}_${issue}`));
  return { expr, valid: issues.length === 0, issues, fields: parsed.map((field) => field.value) };
}

/** @example const iso = nextRun(parseCron("0 9 * * 1-5"), "2026-06-26T08:59:00.000Z"); */
export function nextRun(spec: CronSpec, from: string): string {
  const fromDate = minuteCeil(new Date(from));
  for (let i = 1; i <= 2_629_800; i += 1) {
    const candidate = new Date(fromDate.getTime() + i * 60_000);
    if (matches(spec, candidate)) return candidate.toISOString();
  }
  throw new Error("No future cron run found within five years");
}

/** @example const runs = nextRuns(parseCron("0 * * * *"), "2026-01-01T00:00:00.000Z", 3); */
export function nextRuns(spec: CronSpec, from: string, count: number): readonly string[] {
  const runs: string[] = [];
  let cursor = from;
  for (let i = 0; i < count; i += 1) {
    cursor = nextRun(spec, cursor);
    runs.push(cursor);
  }
  return runs;
}

/** @example const due = isDue(parseCron("0 9 * * 1"), "2026-06-29T09:00:00.000Z"); */
export function isDue(spec: CronSpec, at: string): boolean {
  return matches(spec, new Date(at));
}

/** @example const iso = nextIntervalRun({ everySeconds: 60 }, "2026-01-01T00:00:30.000Z"); */
export function nextIntervalRun(interval: Interval, from: string): string {
  if (interval.everySeconds <= 0) throw new Error("everySeconds must be positive");
  const date = new Date(from);
  return new Date(date.getTime() + interval.everySeconds * 1000).toISOString();
}

function parseField(raw: string, min: number, max: number): { value: CronField; issue: readonly string[] } {
  const values = new Set<number>();
  const issues: string[] = [];
  for (const part of raw.split(",")) addPart(part, min, max, values, issues);
  return { value: { min, max, values }, issue: values.size === 0 ? [...issues, "empty"] : issues };
}

function addPart(raw: string, min: number, max: number, values: Set<number>, issues: string[]): void {
  const [range, stepRaw] = raw.split("/");
  const step = stepRaw ? Number(stepRaw) : 1;
  if (!Number.isInteger(step) || step <= 0) {
    issues.push("bad_step");
    return;
  }
  const bounds = parseBounds(range, min, max);
  if (!bounds) {
    issues.push("bad_range");
    return;
  }
  for (let value = bounds[0]; value <= bounds[1]; value += step) values.add(value);
}

function parseBounds(raw: string, min: number, max: number): readonly [number, number] | null {
  if (raw === "*") return [min, max];
  const numbers = raw.split("-").map((value) => Number(value));
  if (numbers.some((value) => !Number.isInteger(value))) return null;
  const bounds: readonly [number, number] = numbers.length === 1 ? [numbers[0], numbers[0]] : [numbers[0], numbers[1]];
  return bounds[0] >= min && bounds[1] <= max && bounds[0] <= bounds[1] ? bounds : null;
}

function matches(spec: CronSpec, date: Date): boolean {
  if (!spec.valid || spec.fields.length !== 5) return false;
  const values = [date.getUTCMinutes(), date.getUTCHours(), date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCDay()];
  return spec.fields.every((field, index) => field.values.has(values[index]));
}

function minuteCeil(date: Date): Date {
  const rounded = new Date(date);
  rounded.setUTCSeconds(0, 0);
  return rounded;
}
