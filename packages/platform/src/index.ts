import type { ModuleKey, Tenant } from "@cdp-us/contracts";
import { PLANS, canEnableModule, withinLimit, type EnforcementResult, type Metric, type PlanKey, type PlanLimits } from "@cdp-us/billing";

/** @example const account: TenantAccount = { tenant, plan: "free", status: "active" }; */
export type TenantAccount = Readonly<{ tenant: Tenant; plan: PlanKey; status: "active" | "suspended" }>;

/** @example const input: CreateTenantAccountInput = { tenant, plan: "starter" }; */
export type CreateTenantAccountInput = Readonly<{ tenant: Tenant; plan: PlanKey }>;

/** @example const store = new InMemoryTenantAccountStore(); */
export interface TenantAccountStore {
  create(account: TenantAccount): Promise<TenantAccount>;
  get(tenantId: string): Promise<TenantAccount | undefined>;
  save(account: TenantAccount): Promise<TenantAccount>;
}

/** @example const claims: AuthnClaims = { subject: "u1", email: "owner@example.com" }; */
export type AuthnClaims = Readonly<{ subject: string; email?: string; tenantId?: string }>;

/** @example const provider: AuthnProvider = { verify: async () => null }; */
export interface AuthnProvider {
  verify(token: string): Promise<AuthnClaims | null>;
}

/** @example const view = entitlements(account); */
export type EntitlementView = Readonly<{ modules: readonly ModuleKey[]; limits: PlanLimits }>;

/** @example const store = new InMemoryTenantAccountStore([account]); */
export class InMemoryTenantAccountStore implements TenantAccountStore {
  private readonly accounts = new Map<string, TenantAccount>();

  constructor(accounts: readonly TenantAccount[] = []) {
    for (const account of accounts) this.accounts.set(account.tenant.id, account);
  }

  async create(account: TenantAccount): Promise<TenantAccount> {
    if (this.accounts.has(account.tenant.id)) throw new Error("tenant_account_exists");
    this.accounts.set(account.tenant.id, account);
    return account;
  }

  async get(tenantId: string): Promise<TenantAccount | undefined> {
    return this.accounts.get(tenantId);
  }

  async save(account: TenantAccount): Promise<TenantAccount> {
    this.accounts.set(account.tenant.id, account);
    return account;
  }
}

/** @example const provider = new StubAuthnProvider({ subject: "u1" }); */
export class StubAuthnProvider implements AuthnProvider {
  constructor(private readonly claims: AuthnClaims | null = null) {}

  async verify(_token: string): Promise<AuthnClaims | null> {
    return this.claims;
  }
}

/** @example const account = createTenantAccount({ tenant, plan: "free" }); */
export function createTenantAccount(input: CreateTenantAccountInput): TenantAccount {
  return { tenant: { ...input.tenant, enabledModules: [...input.tenant.enabledModules] }, plan: input.plan, status: "active" };
}

/** @example const account = await getTenantAccount(store, "t1"); */
export function getTenantAccount(store: TenantAccountStore, tenantId: string): Promise<TenantAccount | undefined> {
  return store.get(tenantId);
}

/** @example const suspended = suspendTenantAccount(account); */
export function suspendTenantAccount(account: TenantAccount): TenantAccount {
  return { ...account, status: "suspended" };
}

/** @example const upgraded = assignPlan(account, "agency"); */
export function assignPlan(account: TenantAccount, plan: PlanKey): TenantAccount {
  return { ...account, plan };
}

/** @example const result = enforceEntitlement(account, "automation"); */
export function enforceEntitlement(account: TenantAccount, moduleKey: ModuleKey): EnforcementResult {
  if (account.status === "suspended") return { ok: false, reason: "Tenant account is suspended." };
  return canEnableModule(PLANS[account.plan], moduleKey) ? { ok: true } : { ok: false, reason: `Module "${moduleKey}" is not included in your plan.` };
}

/** @example const result = enforceLimit(account, "eventsPerMonth", 999); */
export function enforceLimit(account: TenantAccount, metric: Metric, usage: number): EnforcementResult {
  if (account.status === "suspended") return { ok: false, reason: "Tenant account is suspended." };
  return withinLimit(PLANS[account.plan], metric, usage) ? { ok: true } : { ok: false, reason: `Usage limit reached for "${metric}" (${PLANS[account.plan].limits[metric]}). Please upgrade your plan.` };
}

/** @example const view = entitlements(account); */
export function entitlements(account: TenantAccount): EntitlementView {
  const plan = PLANS[account.plan];
  return { modules: account.status === "suspended" ? [] : plan.entitledModules, limits: plan.limits };
}
