'use strict';
/** File-backed key store: key persistence across runs + ES->file migration. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { ledgerFor, keysFor } = require('../worker');
const { ConsentLedger, verifyChain } = require('../lib/ledger');

test('file key store: key persists across runs and the chain verifies', async () => {
  const dir = path.join(os.tmpdir(), 'cdp-consent-keys-test');
  fs.rmSync(dir, { recursive: true, force: true });
  const stub = { ensureKeysIndex: async () => {}, loadKeys: async () => null, deleteKeys: async () => {} };
  const deps = { keyDir: dir, store: stub, now: () => '2026-01-01T00:00:00.000Z' };

  const l1 = await ledgerFor(deps, 'zavod');
  assert.ok(fs.existsSync(path.join(dir, 'zavod.json')), 'key file written');
  const r1 = l1.append({ tenantId: 'zavod', subject: 's1', state: { x: true }, source: 'checkbox' });

  // second run loads the SAME key from the file (no regeneration)
  const l2 = await ledgerFor(deps, 'zavod');
  const keys = await keysFor(deps, 'zavod');
  const r2 = l2.append({ tenantId: 'zavod', subject: 's1', state: { x: false }, source: 'api' }, r1);
  assert.equal(verifyChain([r1, r2], keys.publicKeyPem).ok, true);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('migration: an existing ES key is moved to the file and deleted from ES', async () => {
  const dir = path.join(os.tmpdir(), 'cdp-consent-keys-migrate');
  fs.rmSync(dir, { recursive: true, force: true });
  const esKeys = new ConsentLedger().exportKeys();
  let esDeleted = false;
  const stub = { ensureKeysIndex: async () => {}, loadKeys: async () => esKeys, deleteKeys: async () => { esDeleted = true; } };
  const deps = { keyDir: dir, store: stub, now: () => '2026-01-01T00:00:00.000Z' };

  await ledgerFor(deps, 'zavod');
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'zavod.json'), 'utf8'));
  assert.equal(onDisk.publicKeyPem, esKeys.publicKeyPem, 'ES key migrated verbatim');
  assert.equal(esDeleted, true, 'ES key removed after migration');

  fs.rmSync(dir, { recursive: true, force: true });
});
