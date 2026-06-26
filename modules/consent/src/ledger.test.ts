import { describe, it, expect } from "vitest";
import type { ConsentRecord, ConsentState } from "@cdp-us/contracts";
import {
  ConsentLedger,
  verifyChain,
  computeRecordHash,
  GENESIS_HASH,
} from "./ledger.js";

const baseState: ConsentState = {
  analytics: true,
  marketing_email: false,
  sale_or_share: true,
  messaging_tcpa: false,
  gpc: false,
};

/** Deterministic clock so tests are fully offline and reproducible. */
function fixedClock(times: string[]): () => string {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)]!;
}

function buildChain(): {
  ledger: ConsentLedger;
  records: ConsentRecord[];
} {
  const ledger = new ConsentLedger({
    now: fixedClock([
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      "2026-01-03T00:00:00.000Z",
    ]),
  });

  const subject = "anon-123";
  const tenantId = "tenant-1";

  const r1 = ledger.append({ tenantId, subject, state: baseState, source: "banner" });
  const r2 = ledger.append(
    {
      tenantId,
      subject,
      state: { ...baseState, marketing_email: true },
      source: "preference_center",
    },
    r1,
  );
  const r3 = ledger.append(
    {
      tenantId,
      subject,
      state: { ...baseState, sale_or_share: false, gpc: true },
      source: "gpc",
    },
    r2,
  );

  return { ledger, records: [r1, r2, r3] };
}

describe("ConsentLedger", () => {
  it("verifies a clean 3-record chain", () => {
    const { ledger, records } = buildChain();
    expect(records).toHaveLength(3);

    const result = verifyChain(records, ledger.publicKey);
    expect(result.ok).toBe(true);
    expect(result.brokenAt).toBeUndefined();
  });

  it("links the first record to GENESIS and chains prevHash", () => {
    const { records } = buildChain();
    expect(records[0]!.prevHash).toBe(GENESIS_HASH);
    expect(records[1]!.prevHash).toBe(records[0]!.hash);
    expect(records[2]!.prevHash).toBe(records[1]!.hash);
  });

  it("detects tampering with a record's state and reports brokenAt", () => {
    const { ledger, records } = buildChain();

    // Tamper: flip sale_or_share on the middle record without re-hashing.
    const tampered: ConsentRecord[] = records.map((r) => ({ ...r }));
    tampered[1] = {
      ...tampered[1]!,
      state: { ...tampered[1]!.state, sale_or_share: false },
    };

    const result = verifyChain(tampered, ledger.publicKey);
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it("detects tampering via recomputed hash mismatch", () => {
    const { records } = buildChain();
    const rec = records[1]!;
    const expected = computeRecordHash({
      prevHash: rec.prevHash,
      state: rec.state,
      subject: rec.subject,
      ts: rec.ts,
      source: rec.source,
    });
    expect(rec.hash).toBe(expected);

    const mutated = computeRecordHash({
      prevHash: rec.prevHash,
      state: { ...rec.state, analytics: false },
      subject: rec.subject,
      ts: rec.ts,
      source: rec.source,
    });
    expect(mutated).not.toBe(expected);
  });

  it("produces a signature that verifies against the public key", () => {
    const { ledger, records } = buildChain();
    const single = [records[0]!];
    const result = verifyChain(single, ledger.publicKey);
    expect(result.ok).toBe(true);
    expect(records[0]!.sig).toBeTruthy();
  });

  it("fails verification under a different public key", () => {
    const { records } = buildChain();
    const other = new ConsentLedger();
    const result = verifyChain(records, other.publicKey);
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(0);
  });

  it("fails when a signature is missing", () => {
    const { ledger, records } = buildChain();
    const noSig: ConsentRecord[] = records.map((r) => ({ ...r }));
    delete noSig[2]!.sig;
    const result = verifyChain(noSig, ledger.publicKey);
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  it("verifies via exported PEM public key (cross-service path)", () => {
    const { ledger, records } = buildChain();
    const pem = ledger.exportPublicKey();
    const result = verifyChain(records, pem);
    expect(result.ok).toBe(true);
  });

  it("round-trips key material so a reconstructed ledger keeps verifying", () => {
    const { ledger, records } = buildChain();
    const keys = ledger.exportKeys();
    const reloaded = new ConsentLedger({ keys });
    // New record appended by the reloaded ledger continues the chain & verifies.
    const r4 = reloaded.append(
      { tenantId: "tenant-1", subject: "anon-123", state: baseState, source: "api", ts: "2026-01-04T00:00:00.000Z" },
      records[2],
    );
    const result = verifyChain([...records, r4], reloaded.publicKey);
    expect(result.ok).toBe(true);
  });
});
