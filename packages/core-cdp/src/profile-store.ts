import type { Firmographics, IntentSignals, Profile, TenantId } from "@cdp-us/contracts";
import { profiles, type Db } from "@cdp-us/db";
import { and, eq } from "drizzle-orm";

/**
 * Persistence boundary for CDP profiles. Implementations upsert by id and
 * support tenant-scoped lookups by id, anonymousId, and userId.
 */
export interface ProfileStore {
  /** Upsert a profile by its id; returns the stored value. */
  save(profile: Profile): Promise<Profile>;
  getById(tenantId: TenantId, id: string): Promise<Profile | undefined>;
  getByAnonymousId(tenantId: TenantId, anonymousId: string): Promise<Profile | undefined>;
  getByUserId(tenantId: TenantId, userId: string): Promise<Profile | undefined>;
  listByTenant(tenantId: TenantId): Promise<Profile[]>;
}

/**
 * In-memory {@link ProfileStore} for tests and local development.
 *
 * @example
 * const store = new InMemoryProfileStore();
 * await store.save(profile);
 * const found = await store.getById(profile.tenantId, profile.id);
 */
export class InMemoryProfileStore implements ProfileStore {
  readonly #byId = new Map<string, Profile>();

  constructor() {
    this.reset();
  }

  /** Drop all stored profiles (test helper). */
  reset(): void {
    this.#byId.clear();
  }

  async save(profile: Profile): Promise<Profile> {
    const stored: Profile = { ...profile };
    this.#byId.set(key(profile.tenantId, profile.id), stored);
    return stored;
  }

  async getById(tenantId: TenantId, id: string): Promise<Profile | undefined> {
    return this.#byId.get(key(tenantId, id));
  }

  async getByAnonymousId(tenantId: TenantId, anonymousId: string): Promise<Profile | undefined> {
    return this.#find(tenantId, (p) => p.anonymousId === anonymousId);
  }

  async getByUserId(tenantId: TenantId, userId: string): Promise<Profile | undefined> {
    return this.#find(tenantId, (p) => p.userId === userId);
  }

  async listByTenant(tenantId: TenantId): Promise<Profile[]> {
    return [...this.#byId.values()].filter((p) => p.tenantId === tenantId);
  }

  #find(tenantId: TenantId, match: (p: Profile) => boolean): Profile | undefined {
    for (const p of this.#byId.values()) {
      if (p.tenantId === tenantId && match(p)) return p;
    }
    return undefined;
  }
}

/**
 * Postgres-backed {@link ProfileStore} over the Drizzle `profiles` table.
 *
 * @example
 * const store = new DbProfileStore(createDb(process.env.DATABASE_URL!));
 * await store.save(profile);
 */
export class DbProfileStore implements ProfileStore {
  constructor(private readonly db: Db) {}

  async save(profile: Profile): Promise<Profile> {
    const row = toRow(profile);
    await this.db.insert(profiles).values(row).onConflictDoUpdate({
      target: profiles.id,
      set: {
        anonymousId: row.anonymousId,
        userId: row.userId,
        email: row.email,
        firmographics: row.firmographics,
        intent: row.intent,
        traits: row.traits,
        updatedAt: row.updatedAt,
      },
    });
    return profile;
  }

  async getById(tenantId: TenantId, id: string): Promise<Profile | undefined> {
    const [row] = await this.db
      .select()
      .from(profiles)
      .where(and(eq(profiles.tenantId, tenantId), eq(profiles.id, id)))
      .limit(1);
    return row ? toProfile(row) : undefined;
  }

  async getByAnonymousId(tenantId: TenantId, anonymousId: string): Promise<Profile | undefined> {
    const [row] = await this.db
      .select()
      .from(profiles)
      .where(and(eq(profiles.tenantId, tenantId), eq(profiles.anonymousId, anonymousId)))
      .limit(1);
    return row ? toProfile(row) : undefined;
  }

  async getByUserId(tenantId: TenantId, userId: string): Promise<Profile | undefined> {
    const [row] = await this.db
      .select()
      .from(profiles)
      .where(and(eq(profiles.tenantId, tenantId), eq(profiles.userId, userId)))
      .limit(1);
    return row ? toProfile(row) : undefined;
  }

  async listByTenant(tenantId: TenantId): Promise<Profile[]> {
    const rows = await this.db.select().from(profiles).where(eq(profiles.tenantId, tenantId));
    return rows.map(toProfile);
  }
}

function key(tenantId: TenantId, id: string): string {
  return JSON.stringify([tenantId, id]);
}

/** Map a Profile to a Drizzle insert row (ISO strings -> Date for timestamptz). */
function toRow(profile: Profile): typeof profiles.$inferInsert {
  return {
    id: profile.id,
    tenantId: profile.tenantId,
    anonymousId: profile.anonymousId,
    userId: profile.userId,
    email: profile.email,
    firmographics: profile.firmographics as Record<string, unknown>,
    intent: profile.intent as Record<string, unknown>,
    traits: profile.traits,
    createdAt: new Date(profile.createdAt),
    updatedAt: new Date(profile.updatedAt),
  };
}

/** Map a Drizzle row to a Profile (timestamptz Date -> ISO string). */
function toProfile(row: typeof profiles.$inferSelect): Profile {
  return {
    id: row.id,
    tenantId: row.tenantId,
    anonymousId: row.anonymousId ?? undefined,
    userId: row.userId ?? undefined,
    email: row.email ?? undefined,
    firmographics: row.firmographics as Firmographics,
    intent: row.intent as IntentSignals,
    traits: row.traits,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
