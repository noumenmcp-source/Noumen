import type { AdminTenant, PlannedState, Profile, TenantEvent } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8110";

export async function listAdminTenants(token: string): Promise<PlannedState<readonly AdminTenant[]>> {
  return plannedFetch<readonly AdminTenant[]>("/v1/admin/tenants", token, []);
}

export async function listSuppression(token: string): Promise<PlannedState<readonly string[]>> {
  return plannedFetch<readonly string[]>("/v1/admin/suppression", token, []);
}

export async function listAudit(token: string): Promise<PlannedState<readonly string[]>> {
  return plannedFetch<readonly string[]>("/v1/admin/audit", token, []);
}

export async function listTenantProfiles(tenantId: string, token: string): Promise<readonly Profile[]> {
  return apiFetch<readonly Profile[]>(`/v1/tenants/${encodeURIComponent(tenantId)}/profiles`, token);
}

export async function listTenantEvents(tenantId: string, token: string): Promise<readonly TenantEvent[]> {
  return apiFetch<readonly TenantEvent[]>(`/v1/tenants/${encodeURIComponent(tenantId)}/events`, token);
}

async function plannedFetch<T>(path: string, token: string, fallback: T): Promise<PlannedState<T>> {
  try {
    return { data: await apiFetch<T>(path, token), planned: false, error: "" };
  } catch (error) {
    return {
      data: fallback,
      planned: true,
      error: error instanceof Error ? error.message : "Endpoint is not available yet.",
    };
  }
}

async function apiFetch<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Request failed with ${response.status}`);
  return (await response.json()) as T;
}
