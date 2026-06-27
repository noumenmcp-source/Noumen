import type { Session, Tenant } from "./types";
import { asTenant } from "./guards";

const KEY = "cdp-us-console-session";

/** Persist an API-token session in browser storage.
 * @example saveSession({ apiToken: "cdpus_x", tenant: null, tenantId: "t_1" })
 */
export function saveSession(session: Session): void {
  localStorage.setItem(KEY, JSON.stringify(session));
}

/** Read the current API-token session.
 * @example const session = readSession()
 */
export function readSession(): Session | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const tenant = asTenant(parsed.tenant);
    return {
      apiToken: typeof parsed.apiToken === "string" ? parsed.apiToken : "",
      tenant,
      tenantId: typeof parsed.tenantId === "string" ? parsed.tenantId : tenant?.id ?? "",
    };
  } catch {
    return null;
  }
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
}

export function sessionFromSignup(apiToken: string, tenant: Tenant): Session {
  return { apiToken, tenant, tenantId: tenant.id };
}
