'use strict';
/**
 * Zero-dependency per-tenant API-token authorization + auth-hardening for the RF
 * CDP node services. RF analogue of the US platform's tenant isolation (Postgres
 * RLS) and auth-hardening (token revocation / expiry / introspection), ported to
 * RF's static env-token model.
 *
 * Phase 2 — tenant isolation: bind a token to the SET OF SITES it may act on, so
 * a token for "aero" cannot touch "zavod" by swapping `site`. 152-ФЗ critical.
 *   - Legacy <PREFIX>_API_TOKEN keeps working as an ADMIN token (all sites) for
 *     service-to-service calls + ops.
 *   - Per-tenant tokens: <PREFIX>_TENANT_TOKENS = "site:token[@expUnix],...".
 *   - Unconfigured (no admin, no tenant tokens) => OPEN (unchanged) + one warning.
 *
 * Phase 3 — auth-hardening (all optional, additive, off unless configured):
 *   - Revocation: <PREFIX>_REVOKED_TOKENS = "tok,tok" => those tokens always 401
 *     (immediate kill-switch for a leaked token, no need to rotate everything).
 *   - Expiry: a tenant token may carry "@<unixSeconds>"; the admin token expiry is
 *     <PREFIX>_API_TOKEN_EXP (unix seconds or ISO-8601). Past expiry => 401.
 *   - Introspection: introspect(token) reports {active, kind, sites, exp, reason}
 *     without throwing — backing an admin-only /v1/auth/introspect endpoint.
 */

/** Parse "site:token[@expUnix],..." into Map(token -> {sites:Set, exp:number|null}). */
function parseTenantConfig(raw) {
  const map = new Map();
  if (!raw) return map;
  for (const pair of String(raw).split(',')) {
    const idx = pair.indexOf(':');
    if (idx <= 0) continue;
    const site = pair.slice(0, idx).trim();
    let rest = pair.slice(idx + 1).trim();
    if (!site || !rest) continue;
    let exp = null;
    const at = rest.lastIndexOf('@');
    if (at > 0) {
      const e = Number(rest.slice(at + 1));
      if (Number.isFinite(e)) { exp = e; rest = rest.slice(0, at).trim(); }
    }
    if (!rest) continue;
    const cur = map.get(rest);
    if (cur) { cur.sites.add(site); if (exp != null && (cur.exp == null || exp < cur.exp)) cur.exp = exp; }
    else map.set(rest, { sites: new Set([site]), exp });
  }
  return map;
}

/** Back-compat helper: Map(token -> Set(site)), ignoring any expiry. */
function parseTenantTokens(raw) {
  const m = new Map();
  for (const [tok, cfg] of parseTenantConfig(raw)) m.set(tok, cfg.sites);
  return m;
}

/** Parse a unix-seconds number or an ISO-8601 string into epoch ms (or null). */
function parseExpiry(v) {
  if (v == null || v === '') return null;
  if (/^\d+$/.test(String(v).trim())) return Number(v) * 1000;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

function parseList(raw) {
  return new Set(String(raw || '').split(',').map((s) => s.trim()).filter(Boolean));
}

/**
 * @param {{adminToken?, tenantTokens?, revokedTokens?, adminExp?, now?, log?}} opts
 *   now: () => epoch ms (injectable for tests).
 */
function makeAuthorizer({ adminToken = '', tenantTokens = '', revokedTokens = '', adminExp = '', now = () => Date.now(), log = () => {} } = {}) {
  const admin = adminToken || '';
  const cfg = parseTenantConfig(tenantTokens);
  const revoked = parseList(revokedTokens);
  const adminExpMs = parseExpiry(adminExp);
  const configured = !!admin || cfg.size > 0;
  if (!configured) {
    log('tenant-auth: WARNING — no tokens configured; auth is OPEN and tenant isolation is NOT enforced');
  }

  function bearer(authHeader) {
    const h = authHeader || '';
    return h.startsWith('Bearer ') ? h.slice('Bearer '.length) : '';
  }

  function authenticate(authHeader) {
    if (!configured) return { ok: true, sites: null, kind: 'open' };
    const tok = bearer(authHeader);
    if (!tok) return { ok: false, code: 401, error: 'unauthorized' };
    if (revoked.has(tok)) return { ok: false, code: 401, error: 'token revoked' };
    if (admin && tok === admin) {
      if (adminExpMs != null && now() > adminExpMs) return { ok: false, code: 401, error: 'token expired' };
      return { ok: true, sites: null, kind: 'admin', exp: adminExpMs };
    }
    const c = cfg.get(tok);
    if (c) {
      if (c.exp != null && now() > c.exp * 1000) return { ok: false, code: 401, error: 'token expired' };
      return { ok: true, sites: c.sites, kind: 'tenant', exp: c.exp != null ? c.exp * 1000 : null };
    }
    return { ok: false, code: 401, error: 'unauthorized' };
  }

  /** Non-throwing inspection of a token (backs an admin /v1/auth/introspect). */
  function introspect(token) {
    const tok = String(token || '');
    if (!tok) return { active: false, reason: 'missing' };
    if (revoked.has(tok)) return { active: false, reason: 'revoked' };
    if (admin && tok === admin) {
      const expired = adminExpMs != null && now() > adminExpMs;
      return { active: !expired, kind: 'admin', sites: null, exp: adminExpMs, ...(expired ? { reason: 'expired' } : {}) };
    }
    const c = cfg.get(tok);
    if (c) {
      const expired = c.exp != null && now() > c.exp * 1000;
      return { active: !expired, kind: 'tenant', sites: [...c.sites], exp: c.exp != null ? c.exp * 1000 : null, ...(expired ? { reason: 'expired' } : {}) };
    }
    return { active: false, reason: 'unknown' };
  }

  return {
    authenticate,
    introspect,
    isConfigured: () => configured,
    isolationEnforced: () => cfg.size > 0,
  };
}

/**
 * Authorize a resolved auth result against a target site. null `sites` => admin/
 * open (any site, incl. site-less ops). A tenant-scoped token must name a site it
 * owns and may not run site-less "all tenants" operations.
 */
function checkSite(authResult, site) {
  if (!authResult || !authResult.ok) {
    return { ok: false, code: (authResult && authResult.code) || 401, error: (authResult && authResult.error) || 'unauthorized' };
  }
  if (authResult.sites == null) return { ok: true };
  if (site == null) return { ok: false, code: 403, error: 'forbidden: scoped token requires an explicit site' };
  if (!authResult.sites.has(site)) return { ok: false, code: 403, error: 'forbidden: token not authorized for site' };
  return { ok: true };
}

module.exports = { parseTenantConfig, parseTenantTokens, parseExpiry, makeAuthorizer, checkSite };
