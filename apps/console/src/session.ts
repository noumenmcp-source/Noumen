import type { Session, Tenant } from "./types";
import { asTenant } from "./guards";

const KEY = "cdp-us-console-session";

/** Persist an API-token session in browser storage.
 * @example saveSession({ apiToken: "cdpus_x", tenant: null, tenantId: "t_1" })
 */
export function saveSession(session: Session): void {
  localStorage.setItem(KEY, JSON.stringify(session));
}

/** Public demo session, if this build was configured with a demo tenant.
 * Lets the promo stand open without a login. The token is read-only-grade
 * (scoped to the demo tenant) and intentionally shipped in the public bundle. */
function demoSession(): Session | null {
  const tenantId = process.env.NEXT_PUBLIC_DEMO_TENANT;
  const apiToken = process.env.NEXT_PUBLIC_DEMO_TOKEN;
  if (!tenantId || !apiToken) return null;
  return { apiToken, tenant: null, tenantId };
}

/** Read the current API-token session.
 * @example const session = readSession()
 */
export function readSession(): Session | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return demoSession();
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
