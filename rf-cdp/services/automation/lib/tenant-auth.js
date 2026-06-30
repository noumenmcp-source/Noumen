'use strict';
/**
 * Zero-dependency per-tenant API-token authorization for the RF CDP node
 * services. This is the RF analogue of the US platform's tenant isolation
 * (which is enforced at the database layer via Postgres RLS): it binds an API
 * token to the SET OF SITES/TENANTS it may act on, so a token issued for tenant
 * "aero" cannot read or mutate tenant "zavod"'s data by swapping the `site`
 * parameter. Critical for 152-ФЗ — no cross-tenant access to personal data.
 *
 * The RF services store per-tenant data in `cdp_*_<site>` ES indices and take
 * `site` from the request (query or body). Before this module the only auth was
 * a single static `<PREFIX>_API_TOKEN`, so any holder of that token could reach
 * any tenant. This closes that hole while staying additive and safe to roll out:
 *
 *  - The legacy `<PREFIX>_API_TOKEN` keeps working as an ADMIN token with access
 *    to ALL sites. Internal service-to-service calls (email-ai -> profile-engine,
 *    automation -> consent-ledger) and ops scripts are therefore unaffected.
 *  - Per-tenant tokens are configured via `<PREFIX>_TENANT_TOKENS`, a simple
 *    comma list of `site:token` pairs (a token may appear for several sites; its
 *    allowed-site set is the union). No JSON quoting headaches in .env files.
 *  - If NOTHING is configured (no admin token, no tenant tokens) the behavior is
 *    UNCHANGED (open), exactly as today, and a one-time warning is logged so an
 *    operator knows isolation is not yet enforced.
 *
 * Enforcement model (see makeAuthorizer + checkSite):
 *   authenticate(header) -> { ok, sites }  where sites === null means "all sites"
 *     (admin or open), or a Set of allowed sites for a tenant-scoped token, or
 *     { ok:false, code:401 } for a missing/unknown token when auth is configured.
 *   checkSite(authResult, site) -> ok unless a tenant-scoped token targets a site
 *     it does not own (403), or omits the site entirely (403 — a scoped token may
 *     never trigger a site-less "all tenants" operation).
 */

/** Parse "site:token,site:token" into Map(token -> Set(site)). */
function parseTenantTokens(raw) {
  const map = new Map();
  if (!raw) return map;
  for (const pair of String(raw).split(',')) {
    const idx = pair.indexOf(':');
    if (idx <= 0) continue;
    const site = pair.slice(0, idx).trim();
    const token = pair.slice(idx + 1).trim();
    if (!site || !token) continue;
    if (!map.has(token)) map.set(token, new Set());
    map.get(token).add(site);
  }
  return map;
}

/**
 * Build an authorizer from the admin token + tenant-token map.
 * @param {{adminToken?:string, tenantTokens?:string, log?:(m:string)=>void}} opts
 */
function makeAuthorizer({ adminToken = '', tenantTokens = '', log = () => {} } = {}) {
  const admin = adminToken || '';
  const map = parseTenantTokens(tenantTokens);
  const configured = !!admin || map.size > 0;
  if (!configured) {
    log('tenant-auth: WARNING — no tokens configured; auth is OPEN and tenant isolation is NOT enforced');
  }

  function bearer(authHeader) {
    const h = authHeader || '';
    return h.startsWith('Bearer ') ? h.slice('Bearer '.length) : '';
  }

  function authenticate(authHeader) {
    if (!configured) return { ok: true, sites: null }; // unchanged legacy behavior
    const tok = bearer(authHeader);
    if (!tok) return { ok: false, code: 401, error: 'unauthorized' };
    if (admin && tok === admin) return { ok: true, sites: null }; // admin: all sites
    const sites = map.get(tok);
    if (sites) return { ok: true, sites };
    return { ok: false, code: 401, error: 'unauthorized' };
  }

  return {
    authenticate,
    isConfigured: () => configured,
    isolationEnforced: () => map.size > 0,
  };
}

/**
 * Authorize a resolved auth result against a specific target site.
 * null `sites` => admin/open (any site, including site-less ops). A tenant-scoped
 * token must name a site it owns and may not run site-less operations.
 */
function checkSite(authResult, site) {
  if (!authResult || !authResult.ok) {
    return { ok: false, code: (authResult && authResult.code) || 401, error: (authResult && authResult.error) || 'unauthorized' };
  }
  if (authResult.sites == null) return { ok: true }; // admin / open
  if (site == null) return { ok: false, code: 403, error: 'forbidden: scoped token requires an explicit site' };
  if (!authResult.sites.has(site)) return { ok: false, code: 403, error: 'forbidden: token not authorized for site' };
  return { ok: true };
}

module.exports = { parseTenantTokens, makeAuthorizer, checkSite };
