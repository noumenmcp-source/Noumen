import type { TenantAccount as PlatformTenantAccount } from "@cdp-us/platform";
import type { TenantStore } from "./tenant.js";

const DEFAULT_PLAN = "agency" as const;
const DEFAULT_STATUS = "active" as const;

export async function getPlatformTenantAccount(
  tenantStore: TenantStore,
  tenantId: string,
): Promise<PlatformTenantAccount | undefined> {
  const account = await tenantStore.getTenantAccount?.(tenantId);
  if (account) return account;
  const tenant = await tenantStore.getTenant(tenantId);
  return tenant ? { tenant, plan: DEFAULT_PLAN, status: DEFAULT_STATUS } : undefined;
}
