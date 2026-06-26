import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from "node:crypto";
import type { ConsentRecord, ConsentState, TenantId } from "@cdp-us/contracts";

/**
 * Signed, hash-chained consent ledger (law-agnostic evidence trail).
 *
 * Each subject (anonymousId or hashed email) gets its own append-only chain:
 * every record links to the previous record's hash via `prevHash`, so tampering
 * with any historical record breaks the chain from that point forward.
 *
 * Integrity = sha256 hash chain.
 * Authenticity / non-repudiation = Ed25519 signature over each record hash.
 */

/** Genesis link for the first record in a per-subject chain. */
export const GENESIS_HASH = "0".repeat(64);

export interface AppendInput {
  tenantId: TenantId;
  /** anonymousId or hashed email. */
  subject: string;
  state: ConsentState;
  /** "banner" | "preference_center" | "gpc" | "api" */
  source: string;
  /** ISO timestamp. Injectable for deterministic tests; defaults to now. */
  ts?: string;
}

export interface VerifyResult {
  ok: boolean;
  /** Index of the first record that failed verification, if any. */
  brokenAt?: number;
}

/** Public-key material exported for verification by other services. */
export interface LedgerKeys {
  /** PEM-encoded SPKI public key. */
  publicKeyPem: string;
  /** PEM-encoded PKCS8 private key. */
  privateKeyPem: string;
}

/**
 * Compute the deterministic content hash for a record.
 *
 * hash = sha256(prevHash + JSON.stringify(state) + subject + ts + source)
 *
 * Exported so verifiers can recompute independently of a ledger instance.
 */
export function computeRecordHash(input: {
  prevHash: string;
  state: ConsentState;
  subject: string;
  ts: string;
  source: string;
}): string {
  const payload =
    input.prevHash +
    JSON.stringify(input.state) +
    input.subject +
    input.ts +
    input.source;
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Accepts an Ed25519 public key in any of: KeyObject, PEM string, or
 * DER-encoded SPKI bytes, and normalizes to a verifying {@link KeyObject}.
 */
function toPublicKeyObject(key: KeyObject | string | Buffer): KeyObject {
  if (Buffer.isBuffer(key)) {
    return createPublicKey({ key, format: "der", type: "spki" });
  }
  if (typeof key === "string") {
    return createPublicKey(key);
  }
  return key;
}

export class ConsentLedger {
  readonly #privateKey: KeyObject;
  readonly #publicKey: KeyObject;
  /** now() is injectable for deterministic, offline tests. */
  readonly #now: () => string;

  /**
   * @param opts.keys      Optional existing key material (PEM). If omitted, a
   *                       fresh Ed25519 key pair is generated.
   * @param opts.now       Optional clock for deterministic timestamps.
   */
  constructor(opts?: { keys?: LedgerKeys; now?: () => string }) {
    if (opts?.keys) {
      this.#privateKey = createPrivateKey(opts.keys.privateKeyPem);
      this.#publicKey = createPublicKey(opts.keys.publicKeyPem);
    } else {
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      this.#privateKey = privateKey;
      this.#publicKey = publicKey;
    }
    this.#now = opts?.now ?? (() => new Date().toISOString());
  }

  /** The verifying public key as a KeyObject. */
  get publicKey(): KeyObject {
    return this.#publicKey;
  }

  /** Export key material (PEM) for persistence / external verification. */
  exportKeys(): LedgerKeys {
    return {
      publicKeyPem: this.#publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
      privateKeyPem: this.#privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
    };
  }

  /** Just the public key (PEM) — safe to embed in clients / share. */
  exportPublicKey(): string {
    return this.#publicKey.export({ type: "spki", format: "pem" }).toString();
  }

  /**
   * Append a new consent record to the subject's chain.
   *
   * @param prev The subject's most recent record, or undefined for the first
   *             record in the chain (links to {@link GENESIS_HASH}).
   */
  append(input: AppendInput, prev?: ConsentRecord): ConsentRecord {
    const ts = input.ts ?? this.#now();
    const prevHash = prev ? prev.hash : GENESIS_HASH;
    const hash = computeRecordHash({
      prevHash,
      state: input.state,
      subject: input.subject,
      ts,
      source: input.source,
    });
    const sig = edSign(null, Buffer.from(hash, "utf8"), this.#privateKey).toString(
      "base64",
    );

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
 * Verify a per-subject chain of consent records:
 *  1. each record's recomputed hash matches its stored `hash`,
 *  2. each record's `prevHash` links to the previous record's `hash`
 *     (first record must link to {@link GENESIS_HASH}),
 *  3. each record's Ed25519 signature over its `hash` verifies.
 *
 * @returns {ok} and, on failure, the {brokenAt} index of the first bad record.
 */
export function verifyChain(
  records: readonly ConsentRecord[],
  publicKey: KeyObject | string | Buffer,
): VerifyResult {
  const pub = toPublicKeyObject(publicKey);
  let prevHash = GENESIS_HASH;

  for (let i = 0; i < records.length; i++) {
    const rec = records[i]!;

    // 1 + 2: recompute hash and check it both matches and chains correctly.
    const expectedHash = computeRecordHash({
      prevHash,
      state: rec.state,
      subject: rec.subject,
      ts: rec.ts,
      source: rec.source,
    });

    if (rec.prevHash !== prevHash || rec.hash !== expectedHash) {
      return { ok: false, brokenAt: i };
    }

    // 3: signature must be present and verify over the record hash.
    if (!rec.sig) {
      return { ok: false, brokenAt: i };
    }
    const sigValid = edVerify(
      null,
      Buffer.from(rec.hash, "utf8"),
      pub,
      Buffer.from(rec.sig, "base64"),
    );
    if (!sigValid) {
      return { ok: false, brokenAt: i };
    }

    prevHash = rec.hash;
  }

  return { ok: true };
}
