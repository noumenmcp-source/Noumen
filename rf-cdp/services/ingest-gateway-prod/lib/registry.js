'use strict';
/**
 * Tenant registry — the isolation spine of the multi-tenant CDP gateway.
 *
 * One physical gateway serves MANY sites (one site = one Dittofeed workspace =
 * one ES raw index). Every inbound event carries an `x-write-key`; the gateway
 * resolves that key to exactly ONE tenant and from then on routes the event
 * ONLY to that tenant's `esIndex` and forwards it ONLY to that tenant's
 * workspace via that tenant's `dittofeedWriteKey`. CORS uses that tenant's own
 * `allowedOrigins`. Unknown key -> resolve() returns null -> caller replies 401.
 * There is deliberately no cross-tenant lookup path: a write key maps to one
 * tenant or to nothing.
 *
 * Tenant shape (all fields required; invalid entries are skipped + warned, never
 * partially loaded — a half-built tenant could silently leak data to the wrong
 * index/workspace, so we refuse it entirely):
 *   {
 *     siteId,              // stable human id for the site (e.g. "zavod")
 *     writeKey,            // public ingest key the storefront sends (x-write-key)
 *     workspaceId,         // Dittofeed workspace this site's profiles live in
 *     dittofeedWriteKey,   // "secretId:value" — sent to Dittofeed as Basic auth
 *     esIndex,             // raw audit index for this site (cdp_events_<siteId>)
 *     allowedOrigins: []   // CORS allow-list for THIS site only
 *   }
 *
 * Backing store is a JSON file: { "tenants": [ {...}, {...} ] }. We build a
 * Map<writeKey, tenant> for O(1) resolve(). reload() re-reads the file so new
 * sites can be hot-added (drop a tenant into tenants.json, call reload()) with
 * no restart. No external deps — Node builtins only, same as the other v2 libs.
 */
const fs = require('fs');
const path = require('path');

// Default tenants file lives next to the gateway (one dir up from lib/).
const DEFAULT_FILE = path.join(__dirname, '..', 'tenants.json');

// Fields every tenant MUST have. allowedOrigins is validated separately (array).
const REQUIRED_STRING_FIELDS = [
  'siteId', 'writeKey', 'workspaceId', 'dittofeedWriteKey', 'esIndex',
];

// Lightweight stderr warn — the gateway uses pino for real logging, but the
// registry must stay dependency-free and usable standalone (self-test, tooling).
function warn(msg) {
  process.stderr.write(`[tenant-registry] WARN ${msg}\n`);
}

// Return true iff `t` is a structurally valid, fully-populated tenant.
// A tenant missing/blanking ANY field is rejected wholesale (see doc above).
function isValidTenant(t, indexForMsg) {
  if (!t || typeof t !== 'object') {
    warn(`tenant #${indexForMsg} is not an object — skipped`);
    return false;
  }
  for (const f of REQUIRED_STRING_FIELDS) {
    if (typeof t[f] !== 'string' || t[f].trim() === '') {
      warn(`tenant #${indexForMsg} (siteId=${t.siteId || '?'}) missing/blank "${f}" — skipped`);
      return false;
    }
  }
  if (!Array.isArray(t.allowedOrigins)) {
    warn(`tenant #${indexForMsg} (siteId=${t.siteId}) "allowedOrigins" must be an array — skipped`);
    return false;
  }
  // Origins must be non-empty strings; an empty/garbage entry would silently
  // widen (or break) CORS for the site, so reject the whole tenant.
  for (const o of t.allowedOrigins) {
    if (typeof o !== 'string' || o.trim() === '') {
      warn(`tenant #${indexForMsg} (siteId=${t.siteId}) has a non-string/blank origin — skipped`);
      return false;
    }
  }
  return true;
}

/**
 * createRegistry({ file }) -> { resolve, list, reload, count, size, tenantOriginAllowed, originAllowedAny }
 *
 * @param {object} [opts]
 * @param {string} [opts.file]  Path to the tenants JSON file. Defaults to
 *                              <gateway>/tenants.json.
 */
function createRegistry(opts) {
  const file = (opts && opts.file) || DEFAULT_FILE;

  // Map<writeKey, tenant> for O(1) resolve; rebuilt atomically on each load.
  let byWriteKey = new Map();

  // Read + parse + validate the file into a fresh Map, then swap it in. We build
  // into a NEW map and only assign on success, so a malformed reload can never
  // leave the registry half-populated or wipe a working tenant set.
  function load() {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (e) {
      warn(`cannot read tenants file "${file}": ${e.message} — keeping existing ${byWriteKey.size} tenant(s)`);
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      warn(`tenants file "${file}" is not valid JSON: ${e.message} — keeping existing ${byWriteKey.size} tenant(s)`);
      return;
    }

    const tenants = parsed && Array.isArray(parsed.tenants) ? parsed.tenants : null;
    if (!tenants) {
      warn(`tenants file "${file}" must be { "tenants": [...] } — keeping existing ${byWriteKey.size} tenant(s)`);
      return;
    }

    const next = new Map();
    for (let i = 0; i < tenants.length; i++) {
      const t = tenants[i];
      if (!isValidTenant(t, i)) continue; // skip+warn already emitted
      if (next.has(t.writeKey)) {
        // Two sites sharing a write key would cross-route events — fatal for
        // isolation. Keep the first, reject the duplicate loudly.
        warn(`duplicate writeKey for siteId=${t.siteId} (already used by siteId=${next.get(t.writeKey).siteId}) — skipped`);
        continue;
      }
      // Precompute the Basic auth header the gateway forwards to Dittofeed with,
      // so the hot path never re-derives it. Built from this tenant's own
      // dittofeedWriteKey -> a tenant can only ever reach its own workspace.
      t.forwardAuth = 'Basic ' + Buffer.from(t.dittofeedWriteKey).toString('base64');
      // Precompile origin matchers (exact string or *.wildcard) for per-tenant CORS.
      t._originMatchers = t.allowedOrigins.map((o) =>
        o.includes('*') ? new RegExp('^' + o.replace(/[.]/g, '\\.').replace(/\*/g, '[^.]+') + '$') : o);
      next.set(t.writeKey, t);
    }

    byWriteKey = next; // atomic swap: resolve() now sees the full new set
  }

  // Origin allowed for a SPECIFIC tenant (per-tenant CORS on POST).
  function originAllowedFor(tenant, origin) {
    if (!origin || !tenant || !tenant._originMatchers) return false;
    return tenant._originMatchers.some((m) => (typeof m === 'string' ? m === origin : m.test(origin)));
  }

  load(); // initial population

  return {
    // O(1) write-key -> tenant. Unknown key -> null (caller emits 401).
    resolve(writeKey) {
      if (typeof writeKey !== 'string') return null;
      return byWriteKey.get(writeKey) || null;
    },
    // Snapshot of all loaded tenants (e.g. for an admin/ops endpoint).
    list() {
      return Array.from(byWriteKey.values());
    },
    // Re-read the file for hot add/remove of sites. Never throws; on a bad file
    // it warns and keeps the previously loaded set.
    reload() {
      load();
    },
    // Number of currently loaded (valid) tenants.
    count() {
      return byWriteKey.size;
    },
    // Alias of count() — server.js calls registry.size().
    size() {
      return byWriteKey.size;
    },
    // Per-tenant CORS check (POST path): is `origin` allowed for THIS tenant?
    tenantOriginAllowed(tenant, origin) {
      return originAllowedFor(tenant, origin);
    },
    // Union CORS check (OPTIONS preflight has no x-write-key): allowed by ANY tenant.
    originAllowedAny(origin) {
      if (!origin) return false;
      for (const t of byWriteKey.values()) if (originAllowedFor(t, origin)) return true;
      return false;
    },
  };
}

module.exports = { createRegistry, DEFAULT_FILE };

// --- inline self-test: node lib/registry.js ---
if (require.main === module) {
  const assert = require('assert');

  const exampleFile = path.join(__dirname, '..', 'tenants.example.json');
  assert.ok(fs.existsSync(exampleFile), `tenants.example.json should exist at ${exampleFile}`);

  const reg = createRegistry({ file: exampleFile });

  // The example ships exactly two sites: zavod + a retail demo.
  assert.strictEqual(reg.count(), 2, `expected 2 tenants in example, got ${reg.count()}`);

  // resolve() returns the right tenant for each key.
  const zavod = reg.resolve('wk_zavod');
  assert.ok(zavod, 'wk_zavod should resolve');
  assert.strictEqual(zavod.siteId, 'zavod', 'wk_zavod -> siteId zavod');
  assert.strictEqual(zavod.esIndex, 'cdp_events_zavod', 'zavod routes to its own index');

  const retail = reg.resolve('wk_retail_demo');
  assert.ok(retail, 'wk_retail_demo should resolve');
  assert.strictEqual(retail.siteId, 'retail-demo', 'wk_retail_demo -> siteId retail-demo');

  // ISOLATION: cross-keys yield DISTINCT tenants with NO shared routing target.
  assert.notStrictEqual(zavod, retail, 'distinct tenants are distinct objects');
  assert.notStrictEqual(zavod.workspaceId, retail.workspaceId, 'distinct workspaceId');
  assert.notStrictEqual(zavod.esIndex, retail.esIndex, 'distinct esIndex');
  assert.notStrictEqual(zavod.dittofeedWriteKey, retail.dittofeedWriteKey, 'distinct dittofeed key');

  // Unknown / malformed keys never resolve to anyone -> caller will 401.
  assert.strictEqual(reg.resolve('wk_does_not_exist'), null, 'unknown key -> null');
  assert.strictEqual(reg.resolve(undefined), null, 'undefined key -> null');
  assert.strictEqual(reg.resolve(123), null, 'non-string key -> null');

  // list() exposes both tenants.
  const ids = reg.list().map((t) => t.siteId).sort();
  assert.deepStrictEqual(ids, ['retail-demo', 'zavod'], 'list() returns both siteIds');

  // reload() is idempotent on an unchanged file (count stable, still resolves).
  reg.reload();
  assert.strictEqual(reg.count(), 2, 'count stable after reload');
  assert.ok(reg.resolve('wk_zavod'), 'still resolves zavod after reload');

  // Bad-file resilience: a temp registry pointed at a missing file loads empty
  // and resolves nothing, without throwing.
  const missing = createRegistry({ file: path.join(__dirname, '..', '__no_such_tenants__.json') });
  assert.strictEqual(missing.count(), 0, 'missing file -> 0 tenants (no throw)');
  assert.strictEqual(missing.resolve('wk_zavod'), null, 'missing file -> resolve null');

  // Validation: a tenant missing a required field is skipped, valid ones kept.
  const tmpFile = path.join(__dirname, '..', `__tenants_test_${process.pid}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify({
    tenants: [
      { siteId: 'good', writeKey: 'wk_good', workspaceId: 'ws_good',
        dittofeedWriteKey: 'sid:val', esIndex: 'cdp_events_good', allowedOrigins: ['https://good.example'] },
      { siteId: 'bad', writeKey: 'wk_bad', workspaceId: 'ws_bad',
        dittofeedWriteKey: 'sid:val', esIndex: 'cdp_events_bad' }, // missing allowedOrigins
      { siteId: 'dup', writeKey: 'wk_good', workspaceId: 'ws_dup',
        dittofeedWriteKey: 'sid:val', esIndex: 'cdp_events_dup', allowedOrigins: ['https://dup.example'] }, // dup key
    ],
  }));
  try {
    const v = createRegistry({ file: tmpFile });
    assert.strictEqual(v.count(), 1, `expected only 1 valid tenant, got ${v.count()}`);
    assert.ok(v.resolve('wk_good'), 'valid tenant kept');
    assert.strictEqual(v.resolve('wk_bad'), null, 'tenant missing allowedOrigins skipped');
    assert.strictEqual(v.resolve('wk_good').siteId, 'good', 'duplicate writeKey kept first (good), rejected dup');
  } finally {
    fs.unlinkSync(tmpFile);
  }

  console.log('tenant-registry self-test OK: 2 tenants, O(1) resolve, cross-key isolation, validation + reload verified');
}
