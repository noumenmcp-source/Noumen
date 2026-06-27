/** @example const row: CohortRow = { subject: "u1", ts: "2026-06-01T00:00:00.000Z" }; */
export type CohortRow = Readonly<{ subject: string; ts: string; step?: string }>;

/** @example const granularity: Granularity = "week"; */
export type Granularity = "day" | "week" | "month";

/** @example const cohort: RetentionCohort = { key: "2026-06", size: 1, retention: [1] }; */
export type RetentionCohort = Readonly<{ key: string; size: number; retention: readonly number[] }>;

/** @example const matrix: RetentionMatrix = buildRetention(rows, { granularity: "month", periods: 3 }); */
export type RetentionMatrix = Readonly<{ cohorts: readonly RetentionCohort[] }>;

/** @example const opts: RetentionOptions = { granularity: "week", periods: 4 }; */
export type RetentionOptions = Readonly<{ granularity: Granularity; periods: number }>;

/** @example const key = cohortKey("2026-06-01T00:00:00.000Z", "month"); */
export function cohortKey(ts: string, granularity: Granularity): string {
  const date = new Date(ts);
  if (granularity === "day") return date.toISOString().slice(0, 10);
  if (granularity === "month") return date.toISOString().slice(0, 7);
  return weekKey(date);
}

/** @example const matrix = buildRetention(rows, { granularity: "week", periods: 3 }); */
export function buildRetention(rows: readonly CohortRow[], opts: RetentionOptions): RetentionMatrix {
  const bySubject = groupBySubject(rows);
  const cohortSubjects = new Map<string, Set<string>>();
  for (const [subject, list] of bySubject) add(cohortSubjects, cohortKey(list[0].ts, opts.granularity), subject);
  const cohorts = [...cohortSubjects.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, subjects]) => retention(key, subjects, bySubject, opts));
  return { cohorts };
}

/** @example const funnel = funnelByCohort(rows, ["visit", "signup"], { granularity: "month", periods: 1 }); */
export function funnelByCohort(rows: readonly CohortRow[], steps: readonly string[], opts: RetentionOptions): Record<string, readonly number[]> {
  const matrix = buildRetention(rows, opts);
  return Object.fromEntries(matrix.cohorts.map((cohort) => [cohort.key, steps.map((step) => stepRate(rows, cohort.key, step, opts.granularity))]));
}

function retention(key: string, subjects: Set<string>, bySubject: Map<string, CohortRow[]>, opts: RetentionOptions): RetentionCohort {
  const retentionValues = Array.from({ length: opts.periods }, (_, offset) => activeRate(key, offset, subjects, bySubject, opts.granularity));
  return { key, size: subjects.size, retention: retentionValues };
}

function activeRate(baseKey: string, offset: number, subjects: Set<string>, bySubject: Map<string, CohortRow[]>, granularity: Granularity): number {
  const active = [...subjects].filter((subject) => bySubject.get(subject)?.some((row) => periodOffset(baseKey, cohortKey(row.ts, granularity), granularity) === offset)).length;
  return subjects.size === 0 ? 0 : active / subjects.size;
}

function periodOffset(baseKey: string, key: string, granularity: Granularity): number {
  if (granularity === "day") return days(baseKey, key);
  if (granularity === "week") return days(`${baseKey}-1`, `${key}-1`) / 7;
  return months(baseKey, key);
}

function groupBySubject(rows: readonly CohortRow[]): Map<string, CohortRow[]> {
  const groups = new Map<string, CohortRow[]>();
  for (const row of [...rows].sort((a, b) => a.ts.localeCompare(b.ts))) {
    groups.set(row.subject, [...(groups.get(row.subject) ?? []), row]);
  }
  return groups;
}

function add<T>(map: Map<string, Set<T>>, key: string, value: T): void;
function add<T>(map: Map<string, T[]>, key: string, value: T): void;
function add<T>(map: Map<string, Set<T> | T[]>, key: string, value: T): void {
  const current = map.get(key);
  if (current instanceof Set) current.add(value);
  else if (Array.isArray(current)) current.push(value);
  else map.set(key, Array.isArray(current) ? [value] : new Set([value]));
}

function weekKey(date: Date): string {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 604_800_000) + 1;
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function days(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

function months(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

function stepRate(rows: readonly CohortRow[], cohort: string, step: string, granularity: Granularity): number {
  const subjects = new Set(rows.filter((row) => cohortKey(row.ts, granularity) === cohort).map((row) => row.subject));
  const hit = new Set(rows.filter((row) => subjects.has(row.subject) && row.step === step).map((row) => row.subject));
  return subjects.size ? hit.size / subjects.size : 0;
}
