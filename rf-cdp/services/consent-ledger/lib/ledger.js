'use strict';
/**
 * Signed, hash-chained consent ledger — ported 1:1 from US `modules/consent/ledger.ts`.
 * Law-agnostic: `state` is treated as an opaque JSON-serializable object, so the
 * same mechanics serve the 152-ФЗ ConsentState unchanged.
 *
 * Each subject gets an append-only chain: every record links to the previous
 * record's hash via `prevHash`, so tampering with any historical record breaks
 * the chain from that point forward.
 *   Integrity     = sha256 hash chain.
 *   Authenticity  = Ed25519 signature over each record hash (deterministic per RFC 8032).
 */
const {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign: edSign,
  verify: edVerify,
} = require('node:crypto');

/** Genesis link for the first record in a per-subject chain. */
const GENESIS_HASH = '0'.repeat(64);

/**
 * Deterministic content hash for a record.
 * hash = sha256(prevHash + JSON.stringify(state) + subject + ts + source)
 * Exported so verifiers can recompute independently of a ledger instance.
 */
function computeRecordHash(input) {
  const payload =
    input.prevHash +
    JSON.stringify(input.state) +
    input.subject +
    input.ts +
    input.source;
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/** Normalize an Ed25519 public key (KeyObject | PEM string | DER SPKI buffer). */
function toPublicKeyObject(key) {
  if (Buffer.isBuffer(key)) return createPublicKey({ key, format: 'der', type: 'spki' });
  if (typeof key === 'string') return createPublicKey(key);
  return key;
}

class ConsentLedger {
  #privateKey;
  #publicKey;
  #now;

  /**
   * @param {{keys?: {publicKeyPem:string, privateKeyPem:string}, now?: () => string}} [opts]
   */
  constructor(opts = {}) {
    if (opts.keys) {
      this.#privateKey = createPrivateKey(opts.keys.privateKeyPem);
      this.#publicKey = createPublicKey(opts.keys.publicKeyPem);
    } else {
      const { privateKey, publicKey } = generateKeyPairSync('ed25519');
      this.#privateKey = privateKey;
      this.#publicKey = publicKey;
    }
    this.#now = opts.now || (() => new Date().toISOString());
  }

  get publicKey() {
    return this.#publicKey;
  }

  /** Export key material (PEM) for persistence / external verification. */
  exportKeys() {
    return {
      publicKeyPem: this.#publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKeyPem: this.#privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
  }

  /** Just the public key (PEM) — safe to embed in clients / share. */
  exportPublicKey() {
    return this.#publicKey.export({ type: 'spki', format: 'pem' }).toString();
  }

  /**
   * Append a new consent record to the subject's chain.
   * @param {import('./contracts').ConsentRecord|undefined} prev the subject's most
   *        recent record, or undefined for the first (links to GENESIS_HASH).
   */
  append(input, prev) {
    const ts = input.ts || this.#now();
    const prevHash = prev ? prev.hash : GENESIS_HASH;
    const hash = computeRecordHash({ prevHash, state: input.state, subject: input.subject, ts, source: input.source });
    const sig = edSign(null, Buffer.from(hash, 'utf8'), this.#privateKey).toString('base64');
    return {
      tenantId: input.tenantId,
      subject: input.subject,
      state: input.state,
      source: input.source,
      ts,
      prevHash,
      hash,
      sig,
    };
  }
}

/**
 * Verify a per-subject chain:
 *  1. each record's recomputed hash matches its stored `hash`,
 *  2. each record's `prevHash` links to the previous record's `hash`
 *     (first must link to GENESIS_HASH),
 *  3. each record's Ed25519 signature over its `hash` verifies.
 * @returns {{ok: boolean, brokenAt?: number}}
 */
function verifyChain(records, publicKey) {
  const pub = toPublicKeyObject(publicKey);
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const expectedHash = computeRecordHash({ prevHash, state: rec.state, subject: rec.subject, ts: rec.ts, source: rec.source });
    if (rec.prevHash !== prevHash || rec.hash !== expectedHash) return { ok: false, brokenAt: i };
    if (!rec.sig) return { ok: false, brokenAt: i };
    const sigValid = edVerify(null, Buffer.from(rec.hash, 'utf8'), pub, Buffer.from(rec.sig, 'base64'));
    if (!sigValid) return { ok: false, brokenAt: i };
    prevHash = rec.hash;
  }
  return { ok: true };
}

module.exports = { GENESIS_HASH, computeRecordHash, ConsentLedger, verifyChain };
