import type { FastifyInstance } from "fastify";
import type { Role } from "@cdp-us/contracts";
import type { TokenStore } from "../auth.js";
import type { OidcClaims, OidcProvider, OidcStateStore } from "../oidc.js";

/** Maps verified OIDC claims to an existing tenant/user, or undefined to deny. */
export type OidcTenantResolver = (claims: OidcClaims) => Promise<{ tenantId: string; userId: string; role: Role } | undefined>;

export type OidcDeps = Readonly<{
  provider: OidcProvider;
  stateStore: OidcStateStore;
  tokenStore: TokenStore;
  resolveTenant: OidcTenantResolver;
  /** Absolute callback URL registered with the IdP. */
  redirectUri: string;
}>;

/**
 * OIDC Authorization-Code routes:
 *  - GET /v1/auth/oidc/login    — start: redirect to the IdP
 *  - GET /v1/auth/oidc/callback — finish: verify, map to a tenant, mint a token
 *
 * Registered only when an IdP is configured, so default behavior is unchanged.
 * @example registerOidc(app, { provider, stateStore, tokenStore, resolveTenant, redirectUri });
 */
export function registerOidc(app: FastifyInstance, deps: OidcDeps): void {
  app.get("/v1/auth/oidc/login", async (_req, reply) => {
    const state = deps.stateStore.issue();
    return reply.redirect(deps.provider.authorizeUrl(state, deps.redirectUri), 302);
  });

  app.get("/v1/auth/oidc/callback", async (req, reply) => {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state) return reply.code(400).send({ error: "missing_code_or_state" });
    if (!deps.stateStore.consume(state)) return reply.code(400).send({ error: "invalid_state" });

    let claims: OidcClaims;
    try {
      claims = await deps.provider.exchangeCode(code, deps.redirectUri);
    } catch {
      return reply.code(401).send({ error: "token_exchange_failed" });
    }

    const mapping = await deps.resolveTenant(claims);
    if (!mapping) return reply.code(403).send({ error: "no_tenant_for_identity" });

    const { token } = await deps.tokenStore.issue(mapping);
    return reply.send({ token, tenantId: mapping.tenantId, email: claims.email ?? null });
  });
}
