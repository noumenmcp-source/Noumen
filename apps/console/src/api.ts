import { asEvents, asHealth, asModules, asProfiles, asTenant } from "./guards";
import type { Health, ModuleManifest, Profile, Tenant, TimelineEvent } from "./types";

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
