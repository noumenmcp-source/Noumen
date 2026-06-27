import type { Profile } from "@cdp-us/contracts";

/** @example const rule: Rule = { field: "firmographics.industry", op: "eq", value: "software", points: 20 }; */
export type Rule = Readonly<{ field: string; op: "eq" | "in" | "exists" | "gte"; value?: unknown; points: number }>;

/** @example const model: ScoringModel = { fitRules: [], weights: { fit: 0.5, engagement: 0.5 } }; */
export type ScoringModel = Readonly<{ fitRules: readonly Rule[]; weights: Readonly<{ fit: number; engagement: number }> }>;

/** @example const result: LeadScore = { score: 82, grade: "A", fit: 90, engagement: 74 }; */
export type LeadScore = Readonly<{ score: number; grade: "A" | "B" | "C" | "D"; fit: number; engagement: number }>;

/** @example const opts: LeadScoreOptions = { now: "2026-01-01T00:00:00.000Z" }; */
export type LeadScoreOptions = Readonly<{ now: string }>;

/** @example const fit = fitScore(profile, model); */
export function fitScore(profile: Profile, model: ScoringModel): number {
  const possible = model.fitRules.reduce((sum, rule) => sum + Math.max(rule.points, 0), 0);
  const earned = model.fitRules.filter((rule) => matchesRule(profile, rule)).reduce((sum, rule) => sum + Math.max(rule.points, 0), 0);
  return possible === 0 ? 0 : clamp(Math.round((earned / possible) * 100), 0, 100);
}

/** @example const engagement = engagementScore(profile, "2026-01-01T00:00:00.000Z"); */
export function engagementScore(profile: Profile, now: string): number {
  const intent = clamp(profile.intent.score ?? 0, 0, 100);
  const recency = recencyScore(profile.intent.lastActiveAt, now);
  return Math.round(intent * 0.7 + recency * 0.3);
}

/** @example const score = leadScore(profile, model, { now: "2026-01-01T00:00:00.000Z" }); */
export function leadScore(profile: Profile, model: ScoringModel, opts: LeadScoreOptions): LeadScore {
  const fit = fitScore(profile, model);
  const engagement = engagementScore(profile, opts.now);
  const totalWeight = model.weights.fit + model.weights.engagement;
  const score = totalWeight <= 0 ? 0 : Math.round((fit * model.weights.fit + engagement * model.weights.engagement) / totalWeight);
  return { score: clamp(score, 0, 100), grade: grade(score), fit, engagement };
}

function matchesRule(profile: Profile, rule: Rule): boolean {
  const value = readPath(profile, rule.field);
  if (rule.op === "exists") return value !== undefined && value !== null && value !== "";
  if (rule.op === "eq") return value === rule.value;
  if (rule.op === "in") return Array.isArray(rule.value) && rule.value.includes(value);
  if (rule.op === "gte") return Number(value) >= Number(rule.value);
  return false;
}

function readPath(profile: Profile, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => (isRecord(value) ? value[key] : undefined), profile);
}

function recencyScore(lastActiveAt: string | undefined, now: string): number {
  if (!lastActiveAt) return 0;
  const ageDays = Math.max(0, Date.parse(now) - Date.parse(lastActiveAt)) / 86_400_000;
  if (ageDays <= 1) return 100;
  if (ageDays <= 7) return 75;
  if (ageDays <= 30) return 40;
  return 10;
}

function grade(score: number): "A" | "B" | "C" | "D" {
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
