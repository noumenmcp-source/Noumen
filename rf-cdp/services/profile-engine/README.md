# RF CDP — profile-engine

Foundational CDP module for the **RF segment**: builds a unified customer profile
from ingest events (identity resolution → profile → segments). Other RF modules
(email targeting, automation) consume its profiles and segments.

## Provenance & charter

Ported from the US `@cdp-us/core-cdp` package (`identity.ts`, `profile-service.ts`,
`segments.ts`, `profile-store.ts`, `contracts`), **rebuilt for the RF runtime** and
**cleaned per `SEGMENTATION.md`**:

- US legal layer is intentionally **not** carried over. `core-cdp` is already
  law-agnostic (no CCPA/TCPA inside it); the US consent types (`ConsentState`,
  `ConsentRecord`, CCPA/TCPA purposes) live in a separate module and are **out of
  scope** here — RF consent is a separate 152-FZ module.
- No cross-repo import: this is a clean reimplementation, not a dependency on `cdp-us`.

## Runtime differences (US → RF)

| | US core-cdp | RF profile-engine |
|---|---|---|
| Language | TypeScript (ESM, pnpm workspace) | plain JS (CommonJS, Node ≥18) — matches the RF gateway runtime |
| Profile store | InMemory + Drizzle/**Postgres** | InMemory + **Elasticsearch** (`cdp_profiles_<tenantId>`) |
| Event source | `/v1/track` API in-process | materialized from gateway's `cdp_events_<siteId>` index |
| Engine logic | identity / profile-service / segments | **ported 1:1** (same merge/stitch/lift/AND semantics) |

Postgres is **not** introduced: RF already runs on Elasticsearch, and the chosen
method is "port on top of the existing RF stack" (no new infra, prod untouched).

## Status — LIVE on 90.156.170.63 (deployed & prod-verified)

**✅ Verified locally:**
- `node --check` clean on all modules.
- `node --test` → **11 pass / 0 fail**. `profile-service.test.js` / `segments.test.js`
  mirror the US `*.test.ts` assertion-for-assertion (engine parity);
  `worker.integration.test.js` drives the worker against an in-process fake ES over
  real HTTP (materialize → profiles → read → idempotency).

**✅ Verified on the live server** (`cdp-profile-engine-1`, port 8130, stack network;
`docker compose -p cdp -f deploy/docker-compose.cdp.yaml`):
- Boot materialize over real indices (`aero`, `zavod`): events → profiles.
- Gateway traits fix deployed: `identify` traits now stored in `cdp_events_<siteId>`
  (additive `traits` field; `traits_present` kept for back-compat).
- End-to-end: `identify{traits}` → materialize → read profile by **userId** and by
  **anonymousId** resolve to the same id, with `traits` merged and `firmographics`
  lifted; `intent.lastActiveAt` set; segment preview matches.
- `cdp_profiles_<siteId>` created via `ensureIndex` with explicit **keyword** mapping
  on id fields (so `term` lookups match); one `_refresh` per materialize run so
  writes are immediately searchable.

**Deploy notes:**
- Host access: `ssh -i ~/.ssh/cdp_server_ed25519 -o IdentitiesOnly=yes root@90.156.170.63`
  (`IdentitiesOnly` required — offering all keys trips sshd MaxAuthTries → reset).
- `/opt/cdp` is scp-managed (not a git checkout). Deploy = scp files + `up -d --build`.

**Next (not in this increment):**
- Expose the read API past loopback (Caddy route + `PROFILE_API_TOKEN`) if external
  access is wanted; today it's loopback-only.
- Switch full-replay → incremental at scale; wire consent/email/social-intel modules
  to consume these profiles.

## Run tests

```bash
cd rf-cdp/services/profile-engine
node --test
```

## Public surface

```js
const {
  ProfileService, resolveExisting, newProfile,
  evaluateSegment, segmentMembers,
  InMemoryProfileStore, EsProfileStore,
} = require('./lib');
```
