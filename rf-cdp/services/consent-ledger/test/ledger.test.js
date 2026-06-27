'use strict';
/**
 * Behavioral parity test — mirrors US `modules/consent/ledger.test.ts`
 * assertion-for-assertion (with the RF 152-ФЗ ConsentState shape), proving the
 * ported hash-chain + Ed25519 ledger matches the US engine.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ConsentLedger, verifyChain, computeRecordHash, GENESIS_HASH } = require('../lib/ledger');

const baseState = {
  pdn_processing: true,
  marketing_email: false,
  analytics: true,
  third_party_transfer: false,
  cross_border: false,
};

function fixedClock(times) {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)];
}

function buildChain() {
  const ledger = new ConsentLedger({
    now: fixedClock(['2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-03T00:00:00.000Z']),
  });
  const subject = 'anon-123';
  const tenantId = 'zavod';
  const r1 = ledger.append({ tenantId, subject, state: baseState, source: 'checkbox' });
  const r2 = ledger.append({ tenantId, subject, state: { ...baseState, marketing_email: true }, source: 'preference_center' }, r1);
  const r3 = ledger.append({ tenantId, subject, state: { ...baseState, third_party_transfer: true }, source: 'api' }, r2);
  return { ledger, records: [r1, r2, r3] };
}

test('verifies a clean 3-record chain', () => {
  const { ledger, records } = buildChain();
  assert.equal(records.length, 3);
  const result = verifyChain(records, ledger.publicKey);
  assert.equal(result.ok, true);
  assert.equal(result.brokenAt, undefined);
});

test('links the first record to GENESIS and chains prevHash', () => {
  const { records } = buildChain();
  assert.equal(records[0].prevHash, GENESIS_HASH);
  assert.equal(records[1].prevHash, records[0].hash);
  assert.equal(records[2].prevHash, records[1].hash);
});

test('detects tampering with a record state and reports brokenAt', () => {
  const { ledger, records } = buildChain();
  const tampered = records.map((r) => ({ ...r }));
  tampered[1] = { ...tampered[1], state: { ...tampered[1].state, pdn_processing: false } };
  const result = verifyChain(tampered, ledger.publicKey);
  assert.equal(result.ok, false);
  assert.equal(result.brokenAt, 1);
});

test('recomputed hash changes when state changes', () => {
  const { records } = buildChain();
  const rec = records[1];
  const expected = computeRecordHash({ prevHash: rec.prevHash, state: rec.state, subject: rec.subject, ts: rec.ts, source: rec.source });
  assert.equal(rec.hash, expected);
  const mutated = computeRecordHash({ prevHash: rec.prevHash, state: { ...rec.state, analytics: false }, subject: rec.subject, ts: rec.ts, source: rec.source });
  assert.notEqual(mutated, expected);
});

test('signature verifies against the public key', () => {
  const { ledger, records } = buildChain();
  const result = verifyChain([records[0]], ledger.publicKey);
  assert.equal(result.ok, true);
  assert.ok(records[0].sig);
});

test('fails verification under a different public key', () => {
  const { records } = buildChain();
  const other = new ConsentLedger();
  const result = verifyChain(records, other.publicKey);
  assert.equal(result.ok, false);
  assert.equal(result.brokenAt, 0);
});

test('fails when a signature is missing', () => {
  const { ledger, records } = buildChain();
  const noSig = records.map((r) => ({ ...r }));
  delete noSig[2].sig;
  const result = verifyChain(noSig, ledger.publicKey);
  assert.equal(result.ok, false);
  assert.equal(result.brokenAt, 2);
});

test('verifies via exported PEM public key (cross-service path)', () => {
  const { ledger, records } = buildChain();
  const pem = ledger.exportPublicKey();
  assert.equal(verifyChain(records, pem).ok, true);
});

test('round-trips key material so a reconstructed ledger keeps verifying', () => {
  const { ledger, records } = buildChain();
  const keys = ledger.exportKeys();
  const reloaded = new ConsentLedger({ keys });
  const r4 = reloaded.append(
    { tenantId: 'zavod', subject: 'anon-123', state: baseState, source: 'api', ts: '2026-01-04T00:00:00.000Z' },
    records[2],
  );
  assert.equal(verifyChain([...records, r4], reloaded.publicKey).ok, true);
});

test('deterministic: same key + inputs reproduce identical hash & signature', () => {
  const keys = new ConsentLedger().exportKeys();
  const a = new ConsentLedger({ keys });
  const b = new ConsentLedger({ keys });
  const input = { tenantId: 'zavod', subject: 's1', state: baseState, source: 'checkbox', ts: '2026-02-02T00:00:00.000Z' };
  const ra = a.append(input);
  const rb = b.append(input);
  assert.equal(ra.hash, rb.hash);
  assert.equal(ra.sig, rb.sig);
});
