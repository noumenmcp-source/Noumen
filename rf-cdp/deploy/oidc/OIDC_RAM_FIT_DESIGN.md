# OIDC admin login — design that FITS the 3.8GB box (NOT YET DEPLOYED)

Status: **design only, do not deploy** (per request 2026-06-19). This resolves the one open blocker
that `MULTITENANT_ADMIN_AUTH.md` left unsolved: **RAM**. That doc covers the Dittofeed side correctly
(AUTH_MODE=multi-tenant, RBAC, member→workspace mapping, login flow, isolation) — read it for those
parts. This doc only decides **which OIDC provider fits the current server and how to wire it**.

## The blocker, measured (2026-06-19, server 90.156.170.63)
```
RAM total 3927MB · used 2960 · available 967 · swap 259/4095 used
ES 766/768 (AT LIMIT — do not shrink) · clickhouse 689/1024 · lite 482/640
ingest-gateway 74 · postgres 123 · temporal 114
```
Headroom for new services ≈ **967MB** (with 4GB swap behind it). Authentik (~1.5–2GB) does NOT fit →
that was the real reason OIDC was deferred. Two ways forward that DO fit:

## Decision: Dex (self-hosted, tiny) — primary
**Dex** (`ghcr.io/dexidp/dex`) is a Go OIDC identity provider, ~25MB image, **~30–50MB RAM**. It is a
full OIDC issuer Dittofeed can point at exactly like Keycloak/Authentik, but two orders of magnitude
lighter. It fits the 967MB headroom with room to spare and keeps the admin user list self-hosted (no
third party). Identity store options:
- `enablePasswordDB + staticPasswords` — self-contained email+bcrypt admins in Dex config. Zero
  external dependency. Best for a handful of agency/site admins. (Used in the config template here.)
- upstream connector (Google/GitHub/LDAP) — federate to a corporate IdP later without changing
  Dittofeed wiring; just add a Dex connector.

### RAM budget after adding OIDC
| Change | Δ RAM | Note |
|---|---|---|
| + Dex service (capped) | +~50MB | mem_limit 96m in the overlay; fits in 967MB available |
| lite → EE image (multi-tenant) | ~0 to +150MB | EE keeps the same 640m heap cap; watch first boot |
| **Net** | **fits without upgrade** | swap (3.8GB free) absorbs transient spikes |
Do NOT reclaim RAM from ES (it is at 766/768). Dex draws from free memory, not from ES/CH/PG.

## Alternative A: external managed (Auth0 / WorkOS) — ZERO server RAM
If you prefer no self-hosted IdP at all: `AUTH_PROVIDER=auth0` (natively wired), free tier covers a
handful of admins. Adds **0 MB** to the box. Trade-off: the admin user list lives at a third party
(acceptable for admin login; it holds no end-user PII). Fastest path; same Dittofeed env, different
OPEN_ID_* values from Auth0.

## Alternative B: Authentik — only AFTER a server upgrade to 6–8GB
The richer IdP (groups UI, flows, SCIM). Revisit only if you outgrow Dex's static users AND bump the
box. Until then it does not fit. The Authentik sketch in `MULTITENANT_ADMIN_AUTH.md` §6 stays valid
for that future.

---

## Artifacts in this folder (templates — not wired into the live compose)
- `dex-config.yaml` — Dex issuer + Dittofeed static client + a staticPasswords admin (bcrypt placeholder).
- `docker-compose.oidc-overlay.yaml` — adds the `dex` service (capped 96m) to the stack network; also
  documents the `lite → dittofeed-ee` swap needed for multi-tenant.
- `Caddy-auth.snippet` — Caddy route exposing Dex at `https://auth.90-156-170-63.sslip.io`.
- `.env.oidc.example` — the Dittofeed EE + OIDC env block, pre-filled with Dex endpoints for this host.

## Deploy steps (FOR LATER — do not run now)
1. Generate secrets: `openssl rand -base64 32` (Dittofeed SECRET_KEY), a Dex client secret, and a
   bcrypt hash for the first admin (`htpasswd -bnBC 12 "" 'pw' | tr -d ':\n' | sed 's/$2y/$2a/'`).
2. Fill `dex-config.yaml` (client secret + admin bcrypt + email) and `.env.oidc.example` → `deploy/.env`.
3. Append `Caddy-auth.snippet` to the server Caddyfile; reload Caddy (gets LE cert for auth.<host>).
4. Bring up Dex: `docker compose -p cdp -f deploy/docker-compose.cdp.yaml -f deploy/oidc/docker-compose.oidc-overlay.yaml up -d dex`.
5. Verify discovery: `curl https://auth.90-156-170-63.sslip.io/.well-known/openid-configuration`.
6. Switch Dittofeed `lite → ee` + multi-tenant env, recreate that service ONLY. Watch RAM (`free -m`,
   `docker stats`) — if EE pushes ES into heavy swap, that is the signal the box needs the 6GB bump.
7. Provision the first member→workspace→role per `MULTITENANT_ADMIN_AUTH.md` §4-b (SQL) and log in at
   `https://cdp.90-156-170-63.sslip.io/dashboard`.

## Open items to verify BEFORE deploying (honest gaps)
- **Dittofeed EE licensing.** Multi-tenant requires the `dittofeed/dittofeed-ee` image. Confirm the
  license terms/cost for agency resale before committing — `MULTITENANT_ADMIN_AUTH.md` assumes EE but
  does not state licensing. This is the biggest unknown.
- **AUTH_PROVIDER value for a generic Dex issuer.** Dittofeed natively wires auth0/cognito/keycloak;
  Dex is generic OIDC. Plan: set `AUTH_PROVIDER=keycloak` (closest generic behavior) + explicit
  `OPEN_ID_*` endpoints; verify on a throwaway boot that discovery/callback succeed.
- **EE first-boot RAM.** Measure `docker stats` right after the lite→ee swap; have the 6GB upgrade
  ready as the fallback if ES is forced into sustained swap.

See `mem:research/cdp-server-deploy-live`, `deploy/MULTITENANT_ADMIN_AUTH.md`.
