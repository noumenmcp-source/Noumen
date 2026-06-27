'use strict';
/**
 * Profile persistence boundary — ported from US core-cdp `profile-store.ts`.
 *
 * The US version ships InMemory + Drizzle/Postgres stores. RF runs on
 * Elasticsearch (no Postgres), so the Postgres store is replaced by an
 * ES-backed store that materializes profiles into per-tenant index
 * `cdp_profiles_<tenantId>` — mirroring the gateway's `cdp_events_<siteId>`
 * convention. The InMemory store is preserved verbatim for tests and as the
 * materializer's working-set cache.
 *
 * @typedef {Object} ProfileStore
 * @property {(p: import('./contracts').Profile) => Promise<import('./contracts').Profile>} save
 * @property {(tenantId: string, id: string) => Promise<import('./contracts').Profile|undefined>} getById
 * @property {(tenantId: string, anonymousId: string) => Promise<import('./contracts').Profile|undefined>} getByAnonymousId
 * @property {(tenantId: string, userId: string) => Promise<import('./contracts').Profile|undefined>} getByUserId
 * @property {(tenantId: string) => Promise<import('./contracts').Profile[]>} listByTenant
 */

/**
 * In-memory ProfileStore for tests and local development. Ported 1:1.
 * @implements {ProfileStore}
 */
class InMemoryProfileStore {
  #byId = new Map();

  constructor() {
    this.reset();
  }

  /** Drop all stored profiles (test helper). */
  reset() {
    this.#byId.clear();
  }

  async save(profile) {
    const stored = { ...profile };
    this.#byId.set(key(profile.tenantId, profile.id), stored);
    return stored;
  }

  async getById(tenantId, id) {
    return this.#byId.get(key(tenantId, id));
  }

  async getByAnonymousId(tenantId, anonymousId) {
    return this.#find(tenantId, (p) => p.anonymousId === anonymousId);
  }

  async getByUserId(tenantId, userId) {
    return this.#find(tenantId, (p) => p.userId === userId);
  }

  async listByTenant(tenantId) {
    return [...this.#byId.values()].filter((p) => p.tenantId === tenantId);
  }

  #find(tenantId, match) {
    for (const p of this.#byId.values()) {
      if (p.tenantId === tenantId && match(p)) return p;
    }
    return undefined;
  }
}

function key(tenantId, id) {
  return JSON.stringify([tenantId, id]);
}

/**
 * Elasticsearch-backed ProfileStore. One index per tenant:
 * `${indexPrefix}${tenantId}` (default `cdp_profiles_<tenantId>`). Document
 * id == profile.id. Stored snake_case to match the gateway's ES doc convention.
 *
 * NOTE: integration with a live ES is NOT yet verified end-to-end; covered by
 * the unit tests only through the InMemory store. See README "Status".
 *
 * @implements {ProfileStore}
 */
class EsProfileStore {
  constructor({ esUrl, esAuth = '', indexPrefix = 'cdp_profiles_', fetchImpl = globalThis.fetch, listSize = 1000 } = {}) {
    if (!esUrl) throw new Error('EsProfileStore: esUrl required');
    if (typeof fetchImpl !== 'function') {
      throw new Error('EsProfileStore: fetch unavailable (use Node >=18 or pass fetchImpl)');
    }
    this._esUrl = String(esUrl).replace(/\/+$/, '');
    this._auth = esAuth;
    this._prefix = indexPrefix;
    this._fetch = fetchImpl;
    this._listSize = listSize;
  }

  _index(tenantId) {
    return `${this._prefix}${tenantId}`;
  }

  _headers() {
    const h = { 'content-type': 'application/json' };
    if (this._auth) h.authorization = this._auth;
    return h;
  }

  /**
   * Create the tenant's profile index with an explicit mapping if it does not
   * exist. Identity fields are `keyword` so exact `term` lookups match (dynamic
   * mapping would make them analyzed `text` and break term queries). The
   * firmographics/intent/traits objects are stored but NOT indexed
   * (`enabled:false`) — segments are evaluated in-app, so arbitrary trait keys
   * must not explode the mapping. Returns true if it created the index.
   */
  async ensureIndex(tenantId) {
    const idx = this._index(tenantId);
    const head = await this._fetch(`${this._esUrl}/${idx}`, { method: 'HEAD', headers: this._headers() });
    if (head.status === 200) return false;
    if (head.status !== 404) throw new Error(`ES ensureIndex HEAD ${head.status}`);
    const mapping = {
      mappings: {
        properties: {
          id: { type: 'keyword' },
          tenant_id: { type: 'keyword' },
          anonymous_id: { type: 'keyword' },
          user_id: { type: 'keyword' },
          email: { type: 'keyword' },
          firmographics: { type: 'object', enabled: false },
          intent: { type: 'object', enabled: false },
          traits: { type: 'object', enabled: false },
          created_at: { type: 'date' },
          updated_at: { type: 'date' },
        },
      },
    };
    const res = await this._fetch(`${this._esUrl}/${idx}`, { method: 'PUT', headers: this._headers(), body: JSON.stringify(mapping) });
    // 400 = resource_already_exists race (another worker created it) — tolerate.
    if (!res.ok && res.status !== 400) throw new Error(`ES ensureIndex PUT ${res.status}: ${await safeText(res)}`);
    return true;
  }

  /**
   * Make recent writes visible to search. ES refreshes ~every 1s by default, so
   * a _search immediately after a _doc write may miss it; the materializer calls
   * this once at the end of a run rather than refreshing per document.
   */
  async refresh(tenantId) {
    const idx = this._index(tenantId);
    const res = await this._fetch(`${this._esUrl}/${idx}/_refresh`, { method: 'POST', headers: this._headers() });
    if (!res.ok && res.status !== 404) throw new Error(`ES refresh ${res.status}: ${await safeText(res)}`);
  }

  async save(profile) {
    const idx = this._index(profile.tenantId);
    const url = `${this._esUrl}/${idx}/_doc/${encodeURIComponent(profile.id)}`;
    const res = await this._fetch(url, { method: 'PUT', headers: this._headers(), body: JSON.stringify(toDoc(profile)) });
    if (!res.ok) throw new Error(`ES save ${res.status}: ${await safeText(res)}`);
    return profile;
  }

  async getById(tenantId, id) {
    const idx = this._index(tenantId);
    const url = `${this._esUrl}/${idx}/_doc/${encodeURIComponent(id)}`;
    const res = await this._fetch(url, { headers: this._headers() });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`ES getById ${res.status}: ${await safeText(res)}`);
    const body = await res.json();
    return body && body._source ? fromDoc(body._source) : undefined;
  }

  getByAnonymousId(tenantId, anonymousId) {
    return this._searchOne(tenantId, 'anonymous_id', anonymousId);
  }

  getByUserId(tenantId, userId) {
    return this._searchOne(tenantId, 'user_id', userId);
  }

  async _searchOne(tenantId, field, value) {
    const idx = this._index(tenantId);
    const url = `${this._esUrl}/${idx}/_search`;
    const body = { size: 1, sort: [{ updated_at: { order: 'desc' } }], query: { term: { [field]: value } } };
    const res = await this._fetch(url, { method: 'POST', headers: this._headers(), body: JSON.stringify(body) });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`ES search ${res.status}: ${await safeText(res)}`);
    const json = await res.json();
    const hit = json && json.hits && json.hits.hits && json.hits.hits[0];
    return hit ? fromDoc(hit._source) : undefined;
  }

  async listByTenant(tenantId) {
    const idx = this._index(tenantId);
    const url = `${this._esUrl}/${idx}/_search`;
    const res = await this._fetch(url, {
      method: 'POST', headers: this._headers(),
      body: JSON.stringify({ size: this._listSize, query: { match_all: {} } }),
    });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`ES list ${res.status}: ${await safeText(res)}`);
    const json = await res.json();
    return (json && json.hits && json.hits.hits ? json.hits.hits : []).map((h) => fromDoc(h._source));
  }
}

/** Map a Profile to its ES doc shape (snake_case, gateway convention). */
function toDoc(p) {
  return {
    id: p.id,
    tenant_id: p.tenantId,
    anonymous_id: p.anonymousId ?? null,
    user_id: p.userId ?? null,
    email: p.email ?? null,
    firmographics: p.firmographics || {},
    intent: p.intent || {},
    traits: p.traits || {},
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

/** Map an ES doc back to a Profile. */
function fromDoc(d) {
  return {
    id: d.id,
    tenantId: d.tenant_id,
    anonymousId: d.anonymous_id ?? undefined,
    userId: d.user_id ?? undefined,
    email: d.email ?? undefined,
    firmographics: d.firmographics || {},
    intent: d.intent || {},
    traits: d.traits || {},
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  };
}

async function safeText(res) {
  try { return await res.text(); } catch { return '<no body>'; }
}

module.exports = { InMemoryProfileStore, EsProfileStore, toDoc, fromDoc };
