# CDP local reference stack — full multi-tenant, end-to-end verified (2026-06-19)

The whole CDP runs locally in docker as the REFERENCE to lift onto the permanent server (P0).
Companion: `mem:research/cdp-session2-triggers-and-domain`, `mem:audit/state_2026_06_19`.

## Stack (deploy/docker-compose.cdp.yaml, project -p cdp)
6 containers: lite (Dittofeed), postgres, temporal, clickhouse-server, elasticsearch (added, single-node,
xpack.security off, per-tenant raw index), ingest-gateway (v3 multi-tenant, builds from Dockerfile, mounts
tenants.json :ro). Network dittofeed-network-lite. Brought stack up WITHOUT gateway first (no tenants.json yet),
provisioned sites, then up gateway. ES local was absent -> added to compose so the stack is self-contained.

## One-command site onboarding — PROVEN (provision_site.py)
`python3 scripts/provision_site.py --site <X> --admin-base http://127.0.0.1:3000 --admin-key <Default-key>
--es-url http://127.0.0.1:9200 --pg-container cdp-postgres-1 --lite-container cdp-lite-1 --origins ...`
Per site, idempotent: Workspace (SQL — lite has NO REST flow to create workspaces) + per-workspace AdminApiKey
(SQL) + Default-Email subscription group (admin API) + public write-key (admin API) + ES index cdp_events_<site>
+ **user-properties cloned from Default (11: id/email/anonymousId/...)** + **compute-properties workflow started**
+ tenant row upserted to tenants.json. Then NEXT STEP: p1_load_all_triggers.py per workspace.

## Critical gotchas found & fixed at real assembly (commits cadd1e1, 09f7cc0)
- Dockerfile copied only server.js -> v3 MODULE_NOT_FOUND. Fixed: COPY lib/ + resend-webhook.js.
- provision/registry tenants.json format mismatch -> canonical {"tenants":[...]}.
- p1 uuid5 seeds lacked workspaceId -> 2nd site got 0/63 (IDs globally unique in Dittofeed). Fixed: include WS.
- **A SQL/admin-provisioned workspace ships BARE**: 0 user-properties + NO compute-properties workflow.
  Symptoms: trigger-recompute -> 500 WorkflowNotFoundError; /api/admin/users empty. Default workspace had 11
  user-props + workflow from bootstrap. FIX (now in provision): clone user-props from Default + run
  `reset-compute-properties` via admin-cli INSIDE the lite image (docker exec cdp-lite-1 node
  packages/admin-cli/dist/scripts/cli.js reset-compute-properties -w <ws>). Standalone admin-cli image
  wasn't pullable (docker hub EOF) — but cli.js ships inside lite, use that.
- admin-cli is at packages/admin-cli/dist/scripts/cli.js inside the lite image. Useful cmds:
  bootstrap, reset-compute-properties (-w <ws> / -a all), onboard-user, psql, clickhouse-client.

## Verified end-to-end on the live stack (NOT mocks)
- 3 tenants provisioned (zavod, retail-demo, acme): each own workspace + ES index + write-key + admin-key.
- 21 triggers loaded per workspace (63/63 each, zavod+retail).
- isolation_test.js 12/12 PASS: event of site A only in cdp_events_<A>, not B; 401 unknown key; per-tenant CORS.
- ClickHouse per-workspace isolation: zavod 3 users, retail 1, cross-leak 0.
- Profiles MATERIALISED after recompute: zavod 6, retail 2, acme 1 — isolated per workspace.
- Resend loop closed locally: template test-send -> Ok DFInternalMessageSent via Resend to pm99lvl@gmail.com
  from hello@mail.zavod.dev (verified domain). Set provider: PUT /api/admin/settings/email-providers
  {workspaceId,setDefault:true,config:{type:"Resend",apiKey}}.
- New site 'acme' one-command -> event 204 -> recompute 200 -> profile materialised. Full onboarding works.

## Admin keys (local stack, ephemeral)
Default ws f09402be..., admin key in /tmp/cdp_admin_key_local. Per-workspace admin keys in Secret table
(configValue->>'key' where type=AdminApiKey). zavod ws 1c35d865, retail fa1e089b, acme add1700b.

## Still NOT done locally (honest)
- OIDC admin login (Authentik) — design only (deploy/MULTITENANT_ADMIN_AUTH.md), not stood up.
- Durability (Kafka/WAL) — gateway in-memory queue lost on crash.
- This is the laptop reference; lift to permanent server (P0) = same compose + provision + p1 + point gateway
  DITTOFEED_URL at local lite. recompute needs reset-compute-properties per workspace (provision does it now).
