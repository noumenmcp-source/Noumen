'use strict';
/**
 * Elasticsearch persistence for the consent ledger.
 *  - ledger records  -> `${ledgerPrefix}<site>`  (default cdp_consent_ledger_<site>)
 *  - per-tenant keys  -> `${keysIndex}` doc id = site (default cdp_consent_keys)
 *
 * Identity/hash fields are mapped `keyword` so exact term lookups match; `state`
 * is stored but not indexed (it is opaque to ES — segments/queries read it in-app).
 *
 * SECURITY NOTE: the Ed25519 PRIVATE key is persisted in ES so the signed chain
 * survives restarts deterministically. ES here is RF-resident, auth'd and
 * loopback-only. Hardening TODO: move the private key to a mounted secret/KMS.
 */
const LEDGER_PREFIX = 'cdp_consent_ledger_';
const KEYS_INDEX = 'cdp_consent_keys';

class EsLedgerStore {
  constructor({ esUrl, esAuth = '', fetchImpl = globalThis.fetch, ledgerPrefix = LEDGER_PREFIX, keysIndex = KEYS_INDEX, listSize = 10000 } = {}) {
    if (!esUrl) throw new Error('EsLedgerStore: esUrl required');
    if (typeof fetchImpl !== 'function') throw new Error('EsLedgerStore: fetch unavailable (Node >=18 or pass fetchImpl)');
    this._esUrl = String(esUrl).replace(/\/+$/, '');
    this._auth = esAuth;
    this._fetch = fetchImpl;
    this._prefix = ledgerPrefix;
    this._keysIndex = keysIndex;
    this._listSize = listSize;
  }

  _index(site) { return `${this._prefix}${site}`; }
  _headers() { const h = { 'content-type': 'application/json' }; if (this._auth) h.authorization = this._auth; return h; }
  _req(method, path, body) {
    return this._fetch(`${this._esUrl}${path}`, { method, headers: this._headers(), body: body ? JSON.stringify(body) : undefined });
  }

  async _ensure(index, mapping) {
    const head = await this._req('HEAD', `/${index}`);
    if (head.status === 200) return false;
    if (head.status !== 404) throw new Error(`ensureIndex HEAD ${index} ${head.status}`);
    const res = await this._req('PUT', `/${index}`, mapping);
    if (!res.ok && res.status !== 400) throw new Error(`ensureIndex PUT ${index} ${res.status}: ${await safeText(res)}`);
    return true;
  }

  ensureIndex(site) {
    return this._ensure(this._index(site), {
      mappings: {
        properties: {
          tenant_id: { type: 'keyword' },
          subject: { type: 'keyword' },
          source: { type: 'keyword' },
          ts: { type: 'date' },
          prev_hash: { type: 'keyword' },
          hash: { type: 'keyword' },
          sig: { type: 'keyword' },
          receipt_id: { type: 'keyword' },
          seq: { type: 'integer' },
          state: { type: 'object', enabled: false },
        },
      },
    });
  }

  ensureKeysIndex() {
    return this._ensure(this._keysIndex, {
      mappings: { properties: { public_key_pem: { type: 'keyword' }, private_key_pem: { type: 'keyword' }, created_at: { type: 'date' } } },
    });
  }

  async loadKeys(site) {
    const res = await this._req('GET', `/${this._keysIndex}/_doc/${encodeURIComponent(site)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`loadKeys ${res.status}`);
    const b = await res.json();
    if (!b || !b._source) return null;
    return { publicKeyPem: b._source.public_key_pem, privateKeyPem: b._source.private_key_pem };
  }

  async saveKeys(site, keys, createdAt) {
    const doc = { public_key_pem: keys.publicKeyPem, private_key_pem: keys.privateKeyPem, created_at: createdAt };
    const res = await this._req('PUT', `/${this._keysIndex}/_doc/${encodeURIComponent(site)}?refresh=wait_for`, doc);
    if (!res.ok) throw new Error(`saveKeys ${res.status}: ${await safeText(res)}`);
  }

  async saveRecord(site, doc) {
    // Doc id = record hash (unique, content-addressed) -> idempotent re-writes.
    const res = await this._req('PUT', `/${this._index(site)}/_doc/${encodeURIComponent(doc.hash)}`, doc);
    if (!res.ok) throw new Error(`saveRecord ${res.status}: ${await safeText(res)}`);
  }

  async _search(site, query) {
    const res = await this._req('POST', `/${this._index(site)}/_search`, { size: this._listSize, sort: [{ seq: { order: 'asc' } }], query });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`search ${res.status}: ${await safeText(res)}`);
    const b = await res.json();
    return (b.hits && b.hits.hits ? b.hits.hits : []).map((h) => h._source);
  }

  listAll(site) { return this._search(site, { match_all: {} }); }
  listBySubject(site, subject) { return this._search(site, { term: { subject } }); }

  async refresh(site) {
    const res = await this._req('POST', `/${this._index(site)}/_refresh`);
    if (!res.ok && res.status !== 404) throw new Error(`refresh ${res.status}`);
  }
}

async function safeText(res) { try { return await res.text(); } catch { return '<no body>'; } }

module.exports = { EsLedgerStore, LEDGER_PREFIX, KEYS_INDEX };
