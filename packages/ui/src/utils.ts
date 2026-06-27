export type ClassValue = string | false | null | undefined;

export function cx(...values: readonly ClassValue[]): string {
  return values.filter((value): value is string => Boolean(value)).join(" ");
}

export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:ring-offset-white";
