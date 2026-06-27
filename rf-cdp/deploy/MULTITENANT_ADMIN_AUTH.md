# Multi-tenant admin auth — how live admins log in with per-site isolation

This runbook explains how **human admins** for each resold site log into the CDP control plane
(the Dittofeed dashboard) and see **only their own site's data** — profiles, events, segments,
journeys. It is the admin-login counterpart to the data-plane isolation enforced by the
ingest-gateway (see `../services/ingest-gateway-prod/server.js`) and the deploy runbook
`DEPLOY_DITTOFEED_PERMANENT.md`.

> TL;DR — Turn on Dittofeed's `AUTH_MODE=multi-tenant`, point it at an OIDC provider, and map each
> OIDC user to a **WorkspaceMember** with a role **scoped to one workspace**. Because **1 site = 1
> workspace** and Dittofeed isolates all data natively by `workspaceId`, a member of site A's
> workspace can never read site B's profiles/events/segments/journeys. Isolation is enforced by
> workspace-scoped RBAC inside Dittofeed, not by application glue we maintain.

---

## 0. Where this sits in the isolation spine

The whole platform's hard-isolation guarantee rests on one rule: **1 site = 1 Dittofeed
WORKSPACE**. Two independent planes enforce it, and they must agree:

| Plane | What flows | How a site is isolated |
|-------|-----------|------------------------|
| **Data ingest** (machine) | storefront events via `x-write-key` | gateway resolves write-key → tenant `{siteId, workspaceId, esIndex, dittofeedWriteKey, allowedOrigins}`, then writes ONLY to `cdp_events_<siteId>` and forwards ONLY to that tenant's workspace. Unknown key → 401. |
| **Admin login** (human) | a person opening the dashboard | OIDC user → **WorkspaceMember** row scoped to that site's `workspaceId` with a role. The dashboard/API only ever returns data for workspaces the logged-in member belongs to. |

This document covers the **second row**. Both rows pivot on the same `workspaceId`, so a site is one
workspace end to end: one event index, one event stream, one set of segments/journeys, and one pool
of admins — with no cross-tenant path in either plane.

---

## 1. Why multi-tenant requires an OIDC provider

Dittofeed has three auth modes (`AUTH_MODE`):

- **`anonymous`** — no auth at all. Dev only. **Never** for resale.
- **`single-tenant`** — one shared password (`PASSWORD`) guarding **one** workspace. This is what the
  current `docker-compose.cdp.yaml` / `deploy/.env.example` ship (`AUTH_MODE=single-tenant`). One
  shared login, no per-person identity, no per-site separation of admins. Fine for a single internal
  Default workspace; **unfit** for an agency reselling to many sites with N admins each.
- **`multi-tenant`** — multiple workspaces on one instance, each with its **own set of named member
  accounts** that log in with their **own** credentials and permissions. This is the resale mode.

Multi-tenant deliberately has **no built-in username/password store**. Identity is delegated to an
external **OIDC (OpenID Connect) provider** — Dittofeed is the *relying party*, the provider is the
*identity authority*. This is by design: it gives you SSO, MFA, password policy, lifecycle
(deactivate a person → they lose access to every site at once), and audit, without Dittofeed
re-implementing an IdP. So **multi-tenant ⇒ you must run/point at an OIDC provider.**

`AUTH_MODE=multi-tenant` is only available on the **licensed EE image** (`dittofeed/dittofeed-ee`),
not the MIT `dittofeed-lite` image used today. See `../vendor/dittofeed/docker-compose.ee.yaml`,
which already sets `AUTH_MODE: ${AUTH_MODE:-multi-tenant}` against `dittofeed/dittofeed-ee`. Moving
to resale = switching the compose from the `lite` service to the `ee` service.

### OIDC provider options

`AUTH_PROVIDER` selects the integration. Dittofeed ships first-class support for `auth0`,
`cognito`, and `keycloak`, and works with any standards-compliant OIDC issuer via the generic
`OPEN_ID_*` endpoint variables.

| Provider | Hosting | Cost | When to pick it |
|----------|---------|------|-----------------|
| **WorkOS** | SaaS | free tier, per-connection pricing | You want enterprise SSO (SAML/OIDC) for *your clients'* own IdPs with the least integration work; "AuthKit" gives a hosted login. Set up as a generic OIDC issuer. |
| **Auth0** | SaaS | free tier (limited MAU) | Fastest managed path; `AUTH_PROVIDER=auth0` is natively wired. Good if you don't want to run an IdP. |
| **Authentik** | **self-hosted (free, OSS)** | $0 (your VPS) | **Recommended when the perimeter is self-hosted** (Oracle Always Free / Vultr, same boxes as the stack). No per-MAU cost, full control, OIDC-compliant. Configure as a generic OIDC issuer (treat like `keycloak`). Concrete sketch in §6. |
| **Keycloak** | self-hosted (free, OSS) | $0 (your VPS) | Same niche as Authentik; `AUTH_PROVIDER=keycloak` is natively wired. Heavier (JVM) than Authentik but battle-tested. |

For a self-hosted agency perimeter, **Authentik** (or Keycloak) keeps everything on infrastructure you
already pay nothing for and avoids leaking the admin user list to a third party.

---

## 2. Compose env for multi-tenant + OIDC

Switch the deploy from the single-tenant `lite` service to the EE service and add the OIDC block.
These are the **exact** Dittofeed env var names (verified against Dittofeed's auth-modes docs).

```properties
# --- auth core ---
AUTH_MODE=multi-tenant                 # turns on per-member, multi-workspace auth (EE image only)
AUTH_PROVIDER=keycloak                 # one of: auth0 | cognito | keycloak (use keycloak for Authentik)
SECRET_KEY=<openssl rand -base64 32>   # signs sessions; MUST be a fresh 32-byte base64 value, not the demo default
SIGNOUT_URL=/dashboard/signout         # local signout route
DASHBOARD_API_BASE=https://cdp.<your-host>   # public base URL the dashboard/API is served from (no /dashboard suffix)

# --- OIDC (OpenID Connect) — values come from your provider ---
OPEN_ID_CLIENT_ID=<client id issued by the provider for the Dittofeed app>
OPEN_ID_CLIENT_SECRET=<client secret issued by the provider>
OPEN_ID_ISSUER=https://<idp-host>/application/o/dittofeed/   # issuer / authority URL
OPEN_ID_AUTHORIZATION_URL=https://<idp-host>/application/o/authorize/
OPEN_ID_TOKEN_URL=https://<idp-host>/application/o/token/
OPEN_ID_USER_INFO_URL=https://<idp-host>/application/o/userinfo/
OPEN_ID_END_SESSION_ENDPOINT=https://<idp-host>/application/o/dittofeed/end-session/  # IdP-side logout (Cognito/Keycloak/Authentik)
OPEN_ID_RETURN_TO_QUERY_PARAM=post_logout_redirect_uri      # provider's post-logout redirect param name
ENABLE_PKCE=true                       # optional but recommended for the auth-code flow
```

Notes that bite:
- **`SECRET_KEY` must be rotated off the demo value.** The committed default
  (`GEGL1RHjFVOxIO80Dp8+...`) is public; using it lets anyone forge a session. Generate with
  `openssl rand -base64 32`. This is the same key referenced in `deploy/.env.example`.
- **The provider's redirect/callback URI** must be registered on the provider side as
  `${DASHBOARD_API_BASE}/dashboard/oauth2/callback` (Dittofeed's OIDC callback path). If
  `DASHBOARD_API_BASE` is wrong or the callback isn't allow-listed at the IdP, login bounces.
- For natively-wired providers (`auth0`, `cognito`, `keycloak`) you can often set just
  `AUTH_PROVIDER` + `OPEN_ID_ISSUER` + client id/secret and let discovery fill the rest; the explicit
  `OPEN_ID_AUTHORIZATION_URL` / `OPEN_ID_TOKEN_URL` / `OPEN_ID_USER_INFO_URL` are there for generic
  issuers (e.g. Authentik) or when discovery is unavailable.

### Wiring it into the existing compose

`docker-compose.cdp.yaml` today runs the `lite` service with `AUTH_MODE: ${AUTH_MODE:-single-tenant}`.
For resale, base the stack on `../vendor/dittofeed/docker-compose.ee.yaml` (image
`dittofeed/dittofeed-ee`, which already defaults `AUTH_MODE` to `multi-tenant`) and feed it the env
above via `--env-file deploy/.env`. The Postgres / ClickHouse / Temporal services and the
`ingest-gateway` service are unchanged — only the Dittofeed app service swaps `lite` → `ee` and gains
the OIDC env. The gateway's own write-key→tenant routing is independent of admin auth and needs no
changes.

---

## 3. How an admin actually logs in (the flow)

```
1. Admin opens  https://cdp.<host>/dashboard
2. Dittofeed (AUTH_MODE=multi-tenant) has no local password -> redirects to OPEN_ID_AUTHORIZATION_URL
3. Admin authenticates at the IdP (Authentik/Auth0/...): password + MFA, or their company SSO
4. IdP redirects back to ${DASHBOARD_API_BASE}/dashboard/oauth2/callback with an auth code
5. Dittofeed exchanges the code at OPEN_ID_TOKEN_URL, reads identity from OPEN_ID_USER_INFO_URL
6. Dittofeed finds the matching WorkspaceMember (by the OIDC subject/email) and the workspace(s)
   + role(s) that member is granted
7. The dashboard renders ONLY those workspace(s). The admin picks (or is pinned to) their site's
   workspace and sees only its profiles/events/segments/journeys.
```

Step 6 is the isolation hinge: the session is bound to specific `workspaceId`s. Every dashboard view
and every API call is filtered server-side by the member's workspace membership — there is no UI or
endpoint that returns another workspace's data to a member who isn't in it.

---

## 4. Mapping OIDC user → WorkspaceMember → role (per site)

Dittofeed's RBAC primitive is the **WorkspaceMember** joined to a **Workspace** through a
**WorkspaceMemberRole** carrying one role value. The role enum is:

| Role | Capability (scoped to that one workspace) |
|------|-------------------------------------------|
| **Admin** | Full control of the workspace: settings, members, integrations, all content. |
| **WorkspaceManager** | Manage content & operations (segments, journeys, templates, broadcasts) but not workspace-level/member administration. |
| **Author** | Create/edit content (templates, journeys, segments); no settings/member management. |
| **Viewer** | Read-only: see profiles, events, segments, journeys; cannot change anything. |

A role is **always paired with exactly one `workspaceId`.** That pairing *is* the isolation:
`(member, workspaceId, role)`. Give a person `Admin` on site-A's workspace and they are an admin of
**site A only**; they have zero visibility into site B unless a separate `(member, site-B-workspace,
role)` row also exists.

### Provisioning a member into a site's workspace

When a new OIDC user first authenticates, they have an identity but no workspace yet. You attach them
to the correct site's workspace with a role. Two supported paths:

**a) JIT (just-in-time) via IdP claims (preferred for self-serve).** Configure the IdP to emit a
claim (e.g. a group like `cdp-site-<siteId>-admin`) and let Dittofeed map the claim → workspace +
role on first login. This keeps the source of truth in the IdP: add a person to the
`cdp-site-acme-admin` group in Authentik and they get Admin on the Acme workspace next login; remove
them and access is revoked.

**b) Explicit provisioning via Admin API / DB (deterministic, scriptable).** Look up the workspace id
for the site, then create the `WorkspaceMember` + `WorkspaceMemberRole` rows. This mirrors the
hand-mint pattern already used for admin API keys in `DEPLOY_DITTOFEED_PERMANENT.md` §2. Sketch:

```sql
-- 1. resolve the site's workspace id (1 site = 1 workspace):
--    select id from "Workspace" where name = '<siteId>' limit 1;

-- 2. ensure the member exists (keyed by the OIDC email/subject), then grant a role
--    scoped to THIS workspace only:
INSERT INTO "WorkspaceMember" (id, email, "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'admin@acme.example', now(), now())
ON CONFLICT (email) DO NOTHING;

INSERT INTO "WorkspaceMemberRole" (id, "workspaceId", "workspaceMemberId", role, "createdAt", "updatedAt")
SELECT gen_random_uuid(), w.id, m.id, 'Admin', now(), now()
FROM "Workspace" w, "WorkspaceMember" m
WHERE w.name = '<siteId>' AND m.email = 'admin@acme.example'
ON CONFLICT DO NOTHING;
```

> Column names follow Dittofeed's schema (`WorkspaceMember`, `WorkspaceMemberRole`, `role`). If your
> EE schema version differs, read the live shape first:
> `select column_name from information_schema.columns where table_name='WorkspaceMemberRole';`
> Prefer the Admin API where the EE build exposes a members endpoint; fall back to SQL as above.
> `docker exec -i <postgres>` is required for psql heredocs (no `-i` ⇒ no stdin ⇒ silent no-op),
> exactly as noted in the permanent-deploy runbook.

---

## 5. Adding N admins per site

Each site can have any number of admins, each an independent OIDC identity. To add the Nth admin to a
site:

1. **Create/ensure the person in the IdP** (Authentik/Auth0) — their real corporate or invited
   identity. They authenticate as themselves; no shared credentials.
2. **Grant them a role on that site's workspace** — via the IdP group claim (path a) or an explicit
   `WorkspaceMemberRole` row (path b). Choose the role: `Admin` for a full site owner,
   `WorkspaceManager`/`Author` for operators, `Viewer` for read-only stakeholders.
3. **They log in** — the next login resolves their membership and shows them that workspace.

Examples:
- Site *Acme* with 3 admins: three `(member, acme-workspace, Admin)` rows (or all three in the
  `cdp-site-acme-admin` IdP group). Each logs in as themselves; all three see Acme, none see any
  other site.
- A consultant who manages *Acme* and *Globex* content but owns neither: two rows —
  `(consultant, acme-workspace, WorkspaceManager)` and `(consultant, globex-workspace,
  WorkspaceManager)`. On login they see exactly those two workspaces and nothing else.
- A client stakeholder who only reviews: `(stakeholder, acme-workspace, Viewer)` — read-only Acme.

Revoking access = remove the IdP group membership (path a) or delete the `WorkspaceMemberRole` row
(path b). Removing the IdP user entirely revokes access to **every** site they were on at once.

---

## 6. Concrete Authentik setup sketch (self-hosted, free)

Authentik is OSS and self-hosts cleanly next to the rest of the stack (Oracle Always Free ARM /
Vultr). Treat it as a generic OIDC issuer and point `AUTH_PROVIDER=keycloak` at it (Keycloak-style
generic OIDC behavior).

**1. Run Authentik** (its own compose; separate from the CDP stack so an admin-auth restart never
touches the data plane):
```bash
# Authentik publishes an official docker-compose; bring it up on, e.g., https://auth.<host>
# Set a strong AUTHENTIK_SECRET_KEY and Postgres password in its .env.
docker compose -f authentik-docker-compose.yml up -d
# First-run admin bootstrap: open https://auth.<host>/if/flow/initial-setup/
```

**2. Create the OIDC provider + application in Authentik**
- *Applications → Providers → Create → OAuth2/OpenID Provider*:
  - Name: `dittofeed`
  - Authorization flow: `default-provider-authorization-explicit-consent` (or implicit-consent)
  - Client type: **Confidential** (yields a client secret)
  - **Redirect URI**: `https://cdp.<host>/dashboard/oauth2/callback`
  - Signing key: the default Authentik certificate
  - Note the generated **Client ID** and **Client Secret**.
- *Applications → Applications → Create*: name `Dittofeed CDP`, slug `dittofeed`, bind the provider
  above. (The slug `dittofeed` is what makes the issuer
  `https://auth.<host>/application/o/dittofeed/`.)

**3. Read the endpoints** from the provider's metadata at
`https://auth.<host>/application/o/dittofeed/.well-known/openid-configuration` and map them:

```properties
AUTH_MODE=multi-tenant
AUTH_PROVIDER=keycloak
SECRET_KEY=<openssl rand -base64 32>
DASHBOARD_API_BASE=https://cdp.<host>
OPEN_ID_CLIENT_ID=<Authentik Client ID>
OPEN_ID_CLIENT_SECRET=<Authentik Client Secret>
OPEN_ID_ISSUER=https://auth.<host>/application/o/dittofeed/
OPEN_ID_AUTHORIZATION_URL=https://auth.<host>/application/o/authorize/
OPEN_ID_TOKEN_URL=https://auth.<host>/application/o/token/
OPEN_ID_USER_INFO_URL=https://auth.<host>/application/o/userinfo/
OPEN_ID_END_SESSION_ENDPOINT=https://auth.<host>/application/o/dittofeed/end-session/
OPEN_ID_RETURN_TO_QUERY_PARAM=post_logout_redirect_uri
ENABLE_PKCE=true
```

**4. Model sites as Authentik groups** (drives path-a JIT mapping):
- Create one group per site+role, e.g. `cdp-site-acme-admin`, `cdp-site-acme-viewer`,
  `cdp-site-globex-admin`.
- Add each admin user to the group(s) for the site(s) they administer.
- Ensure the group claim is emitted in the token (Authentik *Scope mappings* → include `groups`).
  Map the group → `(workspace, role)` so first login provisions the member into the right workspace.
  (If you prefer deterministic control, skip group claims and provision via the §4-b SQL instead.)

**5. First admin per site**: create the workspace for the site (its `Workspace.name = <siteId>`),
then grant the first person `Admin` on it (group `cdp-site-<siteId>-admin`, or the §4-b SQL). From
then on that admin can invite/grant the rest.

---

## 7. The isolation guarantee (what makes this safe)

- **One workspace per site, enforced two ways.** The gateway routes data by `workspaceId`
  (`cdp_events_<siteId>` + that workspace's `dittofeedWriteKey`); the dashboard scopes admins by
  `workspaceId` (their `WorkspaceMemberRole`). Same id, both planes.
- **Workspace-scoped RBAC.** A member's role only grants capabilities **inside the workspaces they're
  joined to.** There is no global/super view exposed to tenant admins. An Acme admin issuing any
  dashboard or API request only ever receives Acme's profiles, events, segments, and journeys —
  another site's `workspaceId` is simply not in their session, so its data is unreachable.
- **No cross-tenant path.** Profiles/events/segments/journeys are partitioned by `workspaceId` in
  Dittofeed (Postgres + ClickHouse) natively; the agency-level operator is the only identity that
  spans workspaces, and that is an internal account, never a client admin.
- **Identity lifecycle is centralized.** Because login is delegated to OIDC, deactivating a person at
  the IdP (or removing their group/role) revokes their access immediately and uniformly — no
  forgotten shared passwords, full audit trail at the IdP.

Net: an admin sees **only their site**, one site's data **never** mixes with another's, and the
boundary is the same `workspaceId` that the ingest-gateway already uses on the data plane.

---

## Companion docs
- `DEPLOY_DITTOFEED_PERMANENT.md` — stand up the permanent Dittofeed host, mint admin API keys, close
  the loop. The §2 hand-mint SQL pattern is mirrored for member provisioning here.
- `docker-compose.cdp.yaml` (current single-tenant) and `../vendor/dittofeed/docker-compose.ee.yaml`
  (multi-tenant EE base).
- `.env.example` — the env file these variables extend.
- `../services/ingest-gateway-prod/server.js` — the data-plane side of the same `workspaceId`
  isolation.
