import { randomUUID } from "node:crypto";
import type { ModuleKey, Tenant, User } from "@cdp-us/contracts";

/**
 * In-memory tenant registry (foundation stub).
 * Replaced by a db-backed lookup once the platform module lands.
 */
const demo: Tenant = {
  id: "demo",
  name: "Demo US B2B",
  writeKey: "wk_demo_us",
  region: "us",
  enabledModules: ["email", "consent"],
  createdAt: new Date(0).toISOString(),
};

const demoOwner: User = {
  id: "user_demo_owner",
  tenantId: demo.id,
  email: "owner@example.test",
  role: "owner",
  createdAt: demo.createdAt,
};

export interface CreateTenantAccountInput {
  name: string;
  ownerEmail: string;
  id?: string;
  writeKey?: string;
  ownerId?: string;
  now?: () => string;
}

export interface TenantAccount {
  tenant: Tenant;
  owner: User;
}

const byKey = new Map<string, Tenant>();
const byId = new Map<string, Tenant>();
const usersById = new Map<string, User>();

function addTenant(account: TenantAccount): void {
  if (byId.has(account.tenant.id)) {
    throw new Error("tenant_id_exists");
  }
  if (byKey.has(account.tenant.writeKey)) {
    throw new Error("write_key_exists");
  }
  byId.set(account.tenant.id, account.tenant);
  byKey.set(account.tenant.writeKey, account.tenant);
  usersById.set(account.owner.id, account.owner);
}

export function resetTenantRegistry(): void {
  byKey.clear();
  byId.clear();
  usersById.clear();
  addTenant({ tenant: demo, owner: demoOwner });
}

export function createTenantAccount(
  input: CreateTenantAccountInput,
): TenantAccount {
  const createdAt = input.now?.() ?? new Date().toISOString();
  const tenant: Tenant = {
    id: input.id ?? `t_${randomUUID()}`,
    name: input.name.trim(),
    writeKey: input.writeKey ?? `wk_us_${randomUUID().replaceAll("-", "")}`,
    region: "us",
    enabledModules: ["consent"],
    createdAt,
  };
  const owner: User = {
    id: input.ownerId ?? `u_${randomUUID()}`,
    tenantId: tenant.id,
    email: input.ownerEmail.trim().toLowerCase(),
    role: "owner",
    createdAt,
  };
  addTenant({ tenant, owner });
  return { tenant, owner };
}

export function resolveTenant(writeKey: string): Tenant | undefined {
  return byKey.get(writeKey);
}

export function getTenant(id: string): Tenant | undefined {
  return byId.get(id);
}

export function enableTenantModule(
  tenantId: string,
  moduleKey: ModuleKey,
): Tenant | undefined {
  const tenant = byId.get(tenantId);
  if (!tenant) return undefined;
  if (!tenant.enabledModules.includes(moduleKey)) {
    tenant.enabledModules = [...tenant.enabledModules, moduleKey];
  }
  return tenant;
}

export function listTenants(): Tenant[] {
  return [...byId.values()];
}

resetTenantRegistry();
