const DAY_MS = 86_400_000;

export function day(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

export function addDays(value: string, days: number): string {
  return new Date(Date.parse(`${value}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function dayDiff(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS);
}

export function daysBetween(from: string, to: string): readonly string[] {
  const length = Math.max(0, dayDiff(from, to) + 1);
  return Array.from({ length }, (_value, index) => addDays(from, index));
}
