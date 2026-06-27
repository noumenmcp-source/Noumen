import { asEvents, asHealth, asModules, asProfiles, asTenant } from "./guards";
import type { AudienceEvaluateBody, AudienceResult, FunnelStep, Health, JourneyResult, ModuleManifest, Profile, RetentionPoint, Tenant, TimelineEvent } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8110";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const REQUEST_TIMEOUT_MS = 18000;

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init.headers },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new ApiError(await errorText(res), res.status);
    return (await res.json()) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

async function errorText(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function signup(companyName: string, ownerEmail: string) {
  const data = await request("/v1/signup", {
    method: "POST",
    body: JSON.stringify({ companyName, ownerEmail }),
  });
  const root = data as { apiToken?: unknown; tenant?: unknown; owner?: unknown };
  const tenant = asTenant(root.tenant);
  if (!tenant || typeof root.apiToken !== "string") {
    throw new ApiError("Invalid signup response", 502);
  }
  return { apiToken: root.apiToken, tenant, owner: root.owner };
}

export async function getHealth(): Promise<Health | null> {
  return asHealth(await request("/v1/health"));
}

export async function getModules(): Promise<readonly ModuleManifest[]> {
  return asModules(await request("/v1/modules"));
}

export async function enableModule(
  tenantId: string,
  moduleKey: string,
  token: string,
): Promise<Tenant | null> {
  const data = await request(`/v1/tenants/${tenantId}/modules/${moduleKey}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  return asTenant((data as { tenant?: unknown }).tenant);
}

export async function getProfiles(
  tenantId: string,
  token: string,
): Promise<readonly Profile[]> {
  return asProfiles(await authed(`/v1/tenants/${tenantId}/profiles`, token));
}

export async function getEvents(
  tenantId: string,
  token: string,
  anonymousId?: string,
): Promise<readonly TimelineEvent[]> {
  const query = anonymousId ? `?anonymousId=${encodeURIComponent(anonymousId)}` : "";
  return asEvents(await authed(`/v1/tenants/${tenantId}/events${query}`, token));
}

export function trackerSnippet(writeKey: string): string {
  return `import { createTracker } from "@cdp-us/sdk";

const cdp = createTracker({
  writeKey: "${writeKey}",
  endpoint: "${API_URL}/v1/track"
});

cdp.track("Page Viewed", { path: window.location.pathname });`;
}

function authed(path: string, token: string): Promise<unknown> {
  return request(path, { headers: { authorization: `Bearer ${token}` } });
}

/** @example const result = await evaluateAudience("t_1", token, { rule: [{ path: "traits.plan", equals: "pro" }] }); */
export async function evaluateAudience(tenantId: string, token: string, body: AudienceEvaluateBody): Promise<AudienceResult | null> {
  return asAudienceResult(await authedPost(`/v1/tenants/${tenantId}/audiences/evaluate`, token, body));
}

/** @example const result = await runJourney("t_1", token, { key: "welcome", steps: [] }); */
export async function runJourney(tenantId: string, token: string, definition: unknown): Promise<JourneyResult | null> {
  return asJourneyResult(await authedPost(`/v1/tenants/${tenantId}/journeys/run`, token, { definition }));
}

/** @example const steps = await analyticsFunnel("t_1", token, ["Signup", "Paid"]); */
export async function analyticsFunnel(tenantId: string, token: string, steps: readonly string[]): Promise<readonly FunnelStep[]> {
  const data = await authedPost(`/v1/tenants/${tenantId}/analytics/funnel`, token, { steps });
  const root = isRecord(data) ? data.steps : undefined;
  return Array.isArray(root) ? root.filter(isFunnelStep) : [];
}

/** @example const retained = await analyticsRetention("t_1", token, { cohortDay: "2026-06-01", windowDays: 7, now: "2026-06-08" }); */
export async function analyticsRetention(tenantId: string, token: string, opts: { readonly cohortDay: string; readonly windowDays: number; readonly now: string }): Promise<readonly RetentionPoint[]> {
  const data = await authedPost(`/v1/tenants/${tenantId}/analytics/retention`, token, opts);
  const retained = isRecord(data) && Array.isArray(data.retained) ? data.retained : [];
  return retained.map((rate, day) => ({ day, rate: typeof rate === "number" ? rate : 0 }));
}

export interface TimePoint {
  readonly date: string;
  readonly value: number;
}

/** Daily event/user volume for the dashboard time series.
 * @example const points = await analyticsTimeseries("t_1", token, { metric: "events", from: "2026-05-28", to: "2026-06-27" }); */
export async function analyticsTimeseries(
  tenantId: string,
  token: string,
  opts: { readonly metric: "events" | "users"; readonly from: string; readonly to: string },
): Promise<readonly TimePoint[]> {
  const data = await authedPost(`/v1/tenants/${tenantId}/analytics/timeseries`, token, {
    metric: opts.metric,
    bucket: "day",
    from: opts.from,
    to: opts.to,
  });
  const points = isRecord(data) && Array.isArray(data.points) ? data.points : [];
  return points.filter(isTimePoint);
}

/** Exact segment size via the audiences engine — powers live dashboard breakdowns
 * without shipping every profile to the browser.
 * @example const desktops = await audienceSize("t_1", token, "traits.deviceType", "desktop"); */
export async function audienceSize(tenantId: string, token: string, path: string, equals: unknown): Promise<number> {
  const result = await evaluateAudience(tenantId, token, { name: path, rule: [{ path, equals }], sampleSize: 1 });
  return result?.size ?? 0;
}

function isTimePoint(value: unknown): value is TimePoint {
  return isRecord(value) && typeof value.date === "string" && typeof value.value === "number";
}

function authedPost(path: string, token: string, body: unknown): Promise<unknown> {
  return request(path, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
}

function asAudienceResult(value: unknown): AudienceResult | null {
  if (!isRecord(value) || value.ok !== true || typeof value.tenantId !== "string" || typeof value.key !== "string" || typeof value.size !== "number" || !Array.isArray(value.sampleIds)) return null;
  const overlap = asOverlap(value.overlap);
  return { ok: true, tenantId: value.tenantId, key: value.key, size: value.size, sampleIds: value.sampleIds.filter(isString), ...(overlap ? { overlap } : {}) };
}

function asJourneyResult(value: unknown): JourneyResult | null {
  if (!isRecord(value) || typeof value.journeyKey !== "string" || !isJourneyStatus(value.status) || !Array.isArray(value.results)) return null;
  return { journeyKey: value.journeyKey, status: value.status, results: value.results.filter(isJourneyStepResult) };
}

function asOverlap(value: unknown): AudienceResult["overlap"] | null {
  return isRecord(value) && typeof value.aOnly === "number" && typeof value.bOnly === "number" && typeof value.both === "number" ? { aOnly: value.aOnly, bOnly: value.bOnly, both: value.both } : null;
}

function isFunnelStep(value: unknown): value is FunnelStep {
  return isRecord(value) && typeof value.step === "string" && typeof value.count === "number" && typeof value.dropoff === "number";
}

function isJourneyStepResult(value: unknown): value is JourneyResult["results"][number] {
  return isRecord(value) && typeof value.key === "string" && typeof value.type === "string" && typeof value.status === "string";
}

function isJourneyStatus(value: unknown): value is JourneyResult["status"] {
  return value === "completed" || value === "halted" || value === "rejected";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
