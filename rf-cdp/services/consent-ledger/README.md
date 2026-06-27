# RF CDP — consent-ledger (152-ФЗ)

Signed, append-only **consent evidence ledger** for the RF segment. Turns the
gateway's raw consent receipts (`cdp_consent_<site>`, written by `POST /v1/consent`)
into a per-subject hash-chain, Ed25519-signed, with a read/verify API.

## Provenance & charter

- **Ledger mechanics** (sha256 hash-chain + Ed25519 signature, `verifyChain`) are
  ported **1:1** from US `modules/consent/ledger.ts` — law-agnostic, the `state`
  is opaque to the chain.
- **CMP / purposes** are **rebuilt for 152-ФЗ**, replacing the US model. US used
  opt-out analytics/`sale_or_share`, TCPA `messaging_tcpa`, and Global Privacy
  Control. 152-ФЗ (ст. 9) is **explicit opt-in for every purpose** — default
  denied; no GPC. Cross-border transfer (ст. 12) defaults to **deny** under RF
  data residency. Canonical purposes: `pdn_processing`, `marketing_email`,
  `analytics`, `third_party_transfer`, `cross_border`.
- No cross-repo import: clean reimplementation per `SEGMENTATION.md`.

## How it works

Per site, the worker appends every **not-yet-ledgered** receipt (dedup by receipt
id) to its subject's chain — true append-only tamper evidence, never rebuilt.
Per-tenant Ed25519 keys are persisted (`cdp_consent_keys`); Ed25519 signing is
deterministic (RFC 8032), so re-runs are idempotent. Records land in
`cdp_consent_ledger_<site>`.

## API (loopback :8140)

- `GET  /v1/health`
- `GET  /v1/consent/state?site=&subject=`  → resolved state, `allowedPurposes`, `verified`
- `GET  /v1/consent/chain?site=&subject=`  → full chain + verify result
- `POST /v1/consent/verify {site, subject?}` → verify one subject or whole site
- `GET  /v1/consent/pubkey?site=`          → Ed25519 public key (PEM)
- `POST /v1/ledger/append {site?}`         → append new receipts now

## Status — LIVE on 90.156.170.63 (deployed & prod-verified)

**✅ Verified locally** — `node --test` → **15 pass / 0 fail**:
- `ledger.test.js` mirrors US `ledger.test.ts` assertion-for-assertion (clean chain,
  GENESIS link, tamper `brokenAt`, missing-sig, wrong-key, PEM verify, key round-trip,
  determinism).
- `cmp.test.js` — 152-ФЗ opt-in model, cross-border default-deny, state coercion.
- `worker.integration.test.js` — receipts → append-only chain over a fake ES, with
  idempotency, key stability, and read-path tamper detection (`brokenAt`).

**✅ Verified on the live server** (`cdp-consent-ledger-1`, port 8140):
- 2 gateway consents for one subject → append → `GET /v1/consent/state` returns the
  resolved 152-ФЗ state with `verified: true`; `GET /v1/consent/chain` →
  `length 2`, `verify.ok true`, `seq [0,1]`, genesis-linked, `prevHash` chained;
  `pubkey` returns a PEM Ed25519 key.

**Security note:** the Ed25519 **private key is persisted in ES** so the signed chain
survives restarts deterministically. ES is RF-resident, auth'd, loopback-only.
Hardening TODO: move the private key to a mounted secret / KMS.

## Run tests

```bash
cd rf-cdp/services/consent-ledger
node --test
```
