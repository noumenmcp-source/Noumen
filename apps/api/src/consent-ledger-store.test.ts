import { afterEach, describe, expect, it } from "vitest";
import type { ConsentState } from "@cdp-us/contracts";
import { ConsentLedger, GENESIS_HASH } from "@cdp-us/consent";
import { ConsentLedgerService, InMemoryConsentLedgerStore } from "./consent-ledger-store.js";
import { applyConsentState, resetConsentOverrides, setConsentLedger } from "./consent.js";

const TENANT = "t_1";
const SUBJECT = "anon_1";

function state(marketing: boolean): ConsentState {
  return { analytics: true, marketing_email: marketing, sale_or_share: false, messaging_tcpa: false, gpc: false };
}

/** Deterministic incrementing clock so each record gets a distinct, ordered ts. */
function clock(): () => string {
  let n = 0;
  return () => new Date(Date.UTC(2026, 0, 1, 0, 0, n++)).toISOString();
}

function service(): { svc: ConsentLedgerService; store: InMemoryConsentLedgerStore } {
  const store = new InMemoryConsentLedgerStore();
  const svc = new ConsentLedgerService(new ConsentLedger({ now: clock() }), store);
  return { svc, store };
}

describe("ConsentLedgerService", () => {
  it("chains records: first links to genesis, each next to the prior hash", async () => {
    const { svc } = service();
    const r1 = await svc.record({ tenantId: TENANT, subject: SUBJECT, state: state(false), source: "banner" });
    const r2 = await svc.record({ tenantId: TENANT, subject: SUBJECT, state: state(true), source: "preference_center" });

    expect(r1.prevHash).toBe(GENESIS_HASH);
    expect(r2.prevHash).toBe(r1.hash);
    expect(r1.sig).toBeTruthy();
  });

  it("verifies a well-formed chain", async () => {
    const { svc } = service();
    await svc.record({ tenantId: TENANT, subject: SUBJECT, state: state(false), source: "banner" });
    await svc.record({ tenantId: TENANT, subject: SUBJECT, state: state(true), source: "api" });
    await expect(svc.verify(TENANT, SUBJECT)).resolves.toEqual({ ok: true });
  });

  it("detects tampering with a stored record", async () => {
    const { svc, store } = service();
    await svc.record({ tenantId: TENANT, subject: SUBJECT, state: state(false), source: "banner" });
    await svc.record({ tenantId: TENANT, subject: SUBJECT, state: state(true), source: "api" });

    const chain = await store.chain(TENANT, SUBJECT);
    // Mutate the first record's state in place — its hash no longer matches.
    (chain[0] as { state: ConsentState }).state = state(true);

    const result = await svc.verify(TENANT, SUBJECT);
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(0);
  });

  it("keeps per-subject chains independent", async () => {
    const { svc } = service();
    await svc.record({ tenantId: TENANT, subject: "anon_a", state: state(false), source: "banner" });
    const b1 = await svc.record({ tenantId: TENANT, subject: "anon_b", state: state(true), source: "banner" });

    // anon_b's first record links to genesis, not to anon_a's record.
    expect(b1.prevHash).toBe(GENESIS_HASH);
    await expect(svc.verify(TENANT, "anon_a")).resolves.toEqual({ ok: true });
    await expect(svc.verify(TENANT, "anon_b")).resolves.toEqual({ ok: true });
  });
});

describe("consent gate → ledger wiring", () => {
  afterEach(() => resetConsentOverrides());

  it("appends a verifiable chain on each applyConsentState", async () => {
    const store = new InMemoryConsentLedgerStore();
    const svc = new ConsentLedgerService(new ConsentLedger({ now: clock() }), store);
    setConsentLedger(svc);

    await applyConsentState(TENANT, SUBJECT, state(true));
    await applyConsentState(TENANT, SUBJECT, state(false));

    const chain = await store.chain(TENANT, SUBJECT);
    expect(chain).toHaveLength(2);
    expect(chain[0]?.prevHash).toBe(GENESIS_HASH);
    expect(chain[1]?.prevHash).toBe(chain[0]?.hash);
    await expect(svc.verify(TENANT, SUBJECT)).resolves.toEqual({ ok: true });
  });

  it("never throws from applyConsentState when the ledger sink fails", async () => {
    setConsentLedger({ record: async () => { throw new Error("ledger down"); } });
    await expect(applyConsentState(TENANT, SUBJECT, state(true))).resolves.toBeUndefined();
  });
});
