import { randomUUID } from "node:crypto";
import type { ModuleKey, Tenant, User } from "@cdp-us/contracts";
import { tenants, users, type Db } from "@cdp-us/db";
import { eq } from "drizzle-orm";

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

export interface TenantStore {
  createTenantAccount(input: CreateTenantAccountInput): Promise<TenantAccount>;
  resolveTenant(writeKey: string): Promise<Tenant | undefined>;
  getTenant(id: string): Promise<Tenant | undefined>;
  enableTenantModule(
    tenantId: string,
    moduleKey: ModuleKey,
  ): Promise<Tenant | undefined>;
  listTenants(): Promise<Tenant[]>;
}

export class InMemoryTenantStore implements TenantStore {
  readonly #byKey = new Map<string, Tenant>();
  readonly #byId = new Map<string, Tenant>();
  readonly #usersById = new Map<string, User>();

  constructor() {
    this.reset();
  }

  reset(): void {
    this.#byKey.clear();
    this.#byId.clear();
    this.#usersById.clear();
    this.#addTenant({ tenant: demo, owner: demoOwner });
  }

  async createTenantAccount(
    input: CreateTenantAccountInput,
  ): Promise<TenantAccount> {
    const account = buildTenantAccount(input);
    this.#addTenant(account);
    return account;
  }

  async resolveTenant(writeKey: string): Promise<Tenant | undefined> {
    return this.#byKey.get(writeKey);
  }

  async getTenant(id: string): Promise<Tenant | undefined> {
    return this.#byId.get(id);
  }

  async enableTenantModule(
    tenantId: string,
    moduleKey: ModuleKey,
  ): Promise<Tenant | undefined> {
    const tenant = this.#byId.get(tenantId);
    if (!tenant) return undefined;
    if (!tenant.enabledModules.includes(moduleKey)) {
      tenant.enabledModules = [...tenant.enabledModules, moduleKey];
    }
    return tenant;
  }

  async listTenants(): Promise<Tenant[]> {
    return [...this.#byId.values()];
  }

  #addTenant(account: TenantAccount): void {
    if (this.#byId.has(account.tenant.id)) {
      throw new Error("tenant_id_exists");
    }
    if (this.#byKey.has(account.tenant.writeKey)) {
      throw new Error("write_key_exists");
    }
    this.#byId.set(account.tenant.id, account.tenant);
    this.#byKey.set(account.tenant.writeKey, account.tenant);
    this.#usersById.set(account.owner.id, account.owner);
  }
}

export class DbTenantStore implements TenantStore {
  constructor(private readonly db: Db) {}

  async createTenantAccount(
    input: CreateTenantAccountInput,
  ): Promise<TenantAccount> {
    const account = buildTenantAccount(input);
    await this.db.insert(tenants).values({
      ...account.tenant,
      createdAt: new Date(account.tenant.createdAt),
    });
    await this.db.insert(users).values({
      ...account.owner,
      createdAt: new Date(account.owner.createdAt),
    });
    return account;
  }

  async resolveTenant(writeKey: string): Promise<Tenant | undefined> {
    const [row] = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.writeKey, writeKey))
      .limit(1);
    return row ? toTenant(row) : undefined;
  }

  async getTenant(id: string): Promise<Tenant | undefined> {
    const [row] = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1);
    return row ? toTenant(row) : undefined;
  }

  async enableTenantModule(
    tenantId: string,
    moduleKey: ModuleKey,
  ): Promise<Tenant | undefined> {
    const tenant = await this.getTenant(tenantId);
    if (!tenant) return undefined;
    const enabledModules = tenant.enabledModules.includes(moduleKey)
      ? tenant.enabledModules
      : [...tenant.enabledModules, moduleKey];
    await this.db
      .update(tenants)
      .set({ enabledModules })
      .where(eq(tenants.id, tenantId));
    return { ...tenant, enabledModules };
  }

  async listTenants(): Promise<Tenant[]> {
    const rows = await this.db.select().from(tenants);
    return rows.map(toTenant);
  }
}

function buildTenantAccount(input: CreateTenantAccountInput): TenantAccount {
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
  return { tenant, owner };
}

function toTenant(row: typeof tenants.$inferSelect): Tenant {
  return {
    id: row.id,
    name: row.name,
    writeKey: row.writeKey,
    region: "us",
    enabledModules: row.enabledModules as ModuleKey[],
    createdAt: row.createdAt.toISOString(),
  };
}

const defaultTenantStore = new InMemoryTenantStore();

export function resetTenantRegistry(): void {
  defaultTenantStore.reset();
}

export function createTenantAccount(
  input: CreateTenantAccountInput,
): Promise<TenantAccount> {
  return defaultTenantStore.createTenantAccount(input);
}

export function resolveTenant(writeKey: string): Promise<Tenant | undefined> {
  return defaultTenantStore.resolveTenant(writeKey);
}

export function getTenant(id: string): Promise<Tenant | undefined> {
  return defaultTenantStore.getTenant(id);
}

export function enableTenantModule(
  tenantId: string,
  moduleKey: ModuleKey,
): Promise<Tenant | undefined> {
  return defaultTenantStore.enableTenantModule(tenantId, moduleKey);
}

export function listTenants(): Promise<Tenant[]> {
  return defaultTenantStore.listTenants();
}
