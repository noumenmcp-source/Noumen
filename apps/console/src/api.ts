import { asEvents, asHealth, asModules, asProfiles, asTenant } from "./guards";
import type { AudienceEvaluateBody, AudienceResult, AutomationRunResult, AutomationStep, AutomationStepResult, CampaignResult, DsarKind, EmailCampaignBody, FunnelStep, Health, JourneyResult, ModuleManifest, Profile, RetentionPoint, Tenant, TimelineEvent } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8110";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
    cache: "no-store",
  });
  if (!res.ok) throw new ApiError(await errorText(res), res.status);
  return res.json() as Promise<unknown>;
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

function authedPost(path: string, token: string, body: unknown): Promise<unknown> {
  return request(path, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
}

/** Run a triggered email campaign over live profiles (marketing_email consent enforced per recipient).
 * @example await runEmailCampaign("t_1", token, { trigger: "welcome", from, brandName, physicalAddress, unsubscribeUrl }); */
export async function runEmailCampaign(tenantId: string, token: string, body: EmailCampaignBody): Promise<CampaignResult> {
  const data = await authedPost(`/v1/tenants/${tenantId}/email/campaigns`, token, body);
  const d = isRecord(data) ? data : {};
  return {
    ok: d.ok === true,
    selected: typeof d.selected === "number" ? d.selected : 0,
    sent: typeof d.sent === "number" ? d.sent : 0,
    skippedNoConsent: typeof d.skippedNoConsent === "number" ? d.skippedNoConsent : 0,
  };
}

/** Run an automation scenario (TCPA messaging consent enforced per recipient).
 * @example await runAutomation("t_1", token, [{ kind: "messenger_send", to: "+15555550100", content: "hi", marketing: true }]); */
export async function runAutomation(tenantId: string, token: string, steps: readonly AutomationStep[]): Promise<AutomationRunResult> {
  const data = await authedPost(`/v1/tenants/${tenantId}/automations/run`, token, { steps });
  const d = isRecord(data) ? data : {};
  const summary = isRecord(d.summary) ? d.summary : {};
  const status = (k: string): number => (typeof summary[k] === "number" ? (summary[k] as number) : 0);
  return {
    ok: d.ok === true,
    results: Array.isArray(d.results) ? d.results.filter(isStepResult) : [],
    summary: { sent: status("sent"), posted: status("posted"), waited: status("waited"), skipped: status("skipped") },
  };
}

/** Submit a CCPA data-subject request (access/delete/correct). Returns the raw report payload.
 * @example await dsarRequest("t_1", token, "user@example.com", "access"); */
export async function dsarRequest(tenantId: string, token: string, subject: string, kind: DsarKind): Promise<Record<string, unknown>> {
  const data = await authedPost(`/v1/tenants/${tenantId}/dsar`, token, { subject, kind });
  return isRecord(data) ? data : {};
}

function isStepResult(value: unknown): value is AutomationStepResult {
  return isRecord(value) && typeof value.index === "number" && typeof value.kind === "string" && typeof value.status === "string";
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
