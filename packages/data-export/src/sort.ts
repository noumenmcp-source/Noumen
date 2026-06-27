import type { DeletionTarget, ReportItem } from "./types.js";

/** @example const sorted = sortReportItems([{ source: "profile", field: "email", value: "a" }]); */
export function sortReportItems(items: readonly ReportItem[]): readonly ReportItem[] {
  return [...items].sort((left, right) => reportKey(left).localeCompare(reportKey(right)));
}

/** @example const sorted = sortDeletionTargets([{ type: "profile", key: "p1", action: "delete", legalHold: false }]); */
export function sortDeletionTargets(items: readonly DeletionTarget[]): readonly DeletionTarget[] {
  return [...items].sort((left, right) => deletionKey(left).localeCompare(deletionKey(right)));
}

function reportKey(item: ReportItem): string {
  return `${item.source}:${item.field}:${stableStringify(item.value)}`;
}

function deletionKey(item: DeletionTarget): string {
  return `${item.type}:${item.key}:${item.action}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
