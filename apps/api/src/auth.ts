import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { Role } from "@cdp-us/contracts";
import { apiTokens, type Db } from "@cdp-us/db";
import { eq } from "drizzle-orm";

/**
 * Token-based auth + RBAC for the US platform API.
 * OIDC-ready seam: an OIDC layer would resolve to the same {@link AuthPrincipal}.
 * US-only; no RF/152-FZ concepts.
 */

/** Resolved caller identity behind a bearer token. */
export interface AuthPrincipal {
  readonly tokenId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly role: Role;
}

/** Input to mint a new API token. */
export interface IssueTokenInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly role: Role;
  /** Fixed raw token (tests only); otherwise generated. */
  readonly token?: string;
  readonly id?: string;
}

/** Result of issuing a token; the raw value is returned exactly once. */
export interface IssuedToken {
  readonly token: string;
  readonly principal: AuthPrincipal;
}

/**
 * SHA-256 of a raw token. Only the hash is ever persisted.
 * @example hashToken("cdpus_abc") // => "9f86d0..."
 */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Generate a fresh, opaque bearer token.
 * @example const t = generateRawToken(); // "cdpus_3f2a...."
 */
export function generateRawToken(): string {
  return `cdpus_${randomBytes(24).toString("hex")}`;
}

/** Persistence boundary for API tokens. */
export interface TokenStore {
  issue(input: IssueTokenInput): Promise<IssuedToken>;
  resolve(rawToken: string): Promise<AuthPrincipal | undefined>;
}

/**
 * In-memory token store (default when DATABASE_URL is unset; used by tests).
 * @example
 * const s = new InMemoryTokenStore();
 * const { token } = await s.issue({ tenantId: "t1", userId: "u1", role: "owner" });
 * await s.resolve(token); // => principal
 */
export class InMemoryTokenStore implements TokenStore {
  readonly #byHash = new Map<string, AuthPrincipal>();

  reset(): void {
    this.#byHash.clear();
  }

  async issue(input: IssueTokenInput): Promise<IssuedToken> {
    const token = input.token ?? generateRawToken();
    const principal: AuthPrincipal = {
      tokenId: input.id ?? `tok_${randomUUID()}`,
      tenantId: input.tenantId,
      userId: input.userId,
      role: input.role,
    };
    this.#byHash.set(hashToken(token), principal);
    return { token, principal };
  }

  async resolve(rawToken: string): Promise<AuthPrincipal | undefined> {
    return this.#byHash.get(hashToken(rawToken));
  }
}

/**
 * Postgres-backed token store (used when DATABASE_URL is set).
 * @example new DbTokenStore(createDb(process.env.DATABASE_URL!))
 */
export class DbTokenStore implements TokenStore {
  constructor(private readonly db: Db) {}

  async issue(input: IssueTokenInput): Promise<IssuedToken> {
    const token = input.token ?? generateRawToken();
    const id = input.id ?? `tok_${randomUUID()}`;
    await this.db.insert(apiTokens).values({
      id,
      tenantId: input.tenantId,
      userId: input.userId,
      role: input.role,
      tokenHash: hashToken(token),
    });
    return {
      token,
      principal: { tokenId: id, tenantId: input.tenantId, userId: input.userId, role: input.role },
    };
  }

  async resolve(rawToken: string): Promise<AuthPrincipal | undefined> {
    const [row] = await this.db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.tokenHash, hashToken(rawToken)))
      .limit(1);
    if (!row) return undefined;
    return {
      tokenId: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      role: row.role as Role,
    };
  }
}

const ROLE_RANK: Readonly<Record<Role, number>> = {
  owner: 3,
  admin: 2,
  analyst: 1,
  viewer: 0,
};

/**
 * Whether `role` meets or exceeds the `min` required role.
 * @example roleSatisfies("admin", "analyst") // => true
 */
export function roleSatisfies(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/**
 * Resolve the Bearer principal from a request, or undefined if absent/invalid.
 * @example const p = await authenticate(req, tokenStore); if (!p) reply.code(401);
 */
export async function authenticate(
  req: FastifyRequest,
  store: TokenStore,
): Promise<AuthPrincipal | undefined> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return undefined;
  const raw = header.slice("Bearer ".length).trim();
  if (!raw) return undefined;
  return store.resolve(raw);
}
