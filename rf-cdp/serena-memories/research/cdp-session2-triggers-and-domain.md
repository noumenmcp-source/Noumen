# CDP session 2 — triggers + domain + v2 5000/s gateway + multi-tenant isolation (2026-06-19)

State ~80% → ~88%. Companion: `mem:audit/state_2026_06_19`.

## P1 DONE — 21 triggers in Dittofeed
`scripts/p1_load_all_triggers.py` — 21 templates+segments+journeys (Running), 63/63 2xx.
GOTCHA: journey entryNode type `"EntryNode"` (not "SegmentEntryNode"). Admin key in Secret.configValue->>'key'.
Workspace `adfb18b4-9d92-4610-ada3-ab1fa9b158b7`. Triggers on LAPTOP Dittofeed (permanent only after P0).

## P2 DONE — Resend brand domain mail.zavod.dev VERIFIED
id `ec31859e-7f3c-46bc-88a0-56864c82ccdd`, us-east-1. Sends from hello@mail.zavod.dev to ANY recipient.
DNS = GoDaddy (ns71/72.domaincontrol.com). 3 records: TXT resend._domainkey.mail (DKIM), MX send.mail=
feedback-smtp.us-east-1.amazonses.com pri10, TXT send.mail=v=spf1 include:amazonses.com ~all.
GOTCHA: GoDaddy "Save All Records" 3-batch FAILS SILENTLY — save ONE AT A TIME. Verify via DoH
(cloudflare-dns.com/dns-query, accept: application/dns-json); UDP dig firewall-blocked here.
Vercel token: ~/Library/Application Support/com.vercel.cli/auth.json (strip // lines). proj prj_CTXdcmT7pb9Vba0tpnm3lIV0LlWT.

## Storefront LIVE — prod flag ON, real users flowing
NEXT_PUBLIC_CDP_ENDPOINT=https://cdp.137-220-56-211.sslip.io/v1 (Preview+Production). Acceptance #2/#3 passed.
Real zavod.dev users captured (raw 100% in ES). cloudflared tunnel 503-on-browser abandoned; caddy serves 204.
Box in Illinois US (Vultr) — 152-FZ localization WAIVED by owner under their responsibility (was legal blocker).

## gateway v2 (5000/s) — DEPLOYED prod blue-green, commit 1cd251e
v1 ceiling ~700/s (single worker, raw COUPLED to slow tunnel-forward, per-request pino). Rewrite (workflow
w6q46qncw 6 comps + Flot gpt-5.5 review): logger:false; ingest-queue bounded ring 100k + 503 backpressure;
bulk-es ES _bulk (1000/200ms); forward-pool 32 concurrent (own queue, never blocks ingest); cluster.js; loadtest.js.
LOCAL BENCH: 5000 target -> 4994/s, p99 750ms, 0 err (vs v1 @2000: 684/s, p99 10.3s, 16 timeouts).
BLUE-GREEN on box: /opt/cdp-gateway-v2 systemd cdp-gateway-v2 :8111, caddy 8110->8111. Old /opt/cdp-gateway
:8110 kept to DRAIN in-RAM backlog (restart loses it — stop once queued~0). PROD on v2: raw.stored==received
(raw_gap=0, root defect gone), forward-pool ~25/s via tunnel. Full 5000/s forward needs LOCAL Dittofeed (P0).
v2 health: {received, raw:{stored,failed,inflight,pending}, forward:{...}, queued, dropped}.

## Multi-tenant isolation (v3) — built + verified 12/12, commit d99a26a (NOT deployed)
Requirement: agency resells to MANY sites, N admins each, separate user pools — data NEVER mixes.
Model: 1 site = 1 Dittofeed workspace + 1 ES index (cdp_events_<siteId>). Gateway resolves x-write-key ->
one tenant -> routes ONLY to its index + forwards ONLY to its workspace with its own key. Workflow wpzevgst3
(7 agents). Files in services/ingest-gateway-prod/:
- lib/registry.js (server requires ./lib/registry): write-key->tenant {siteId,workspaceId,dittofeedWriteKey,
  esIndex,allowedOrigins}; O(1) resolve, dup-key reject, per-tenant+union CORS, precomputed forwardAuth, hot reload.
- lib/bulk-es.js multi-index add(index,doc); lib/forward-pool.js per-item forwardUrl+forwardAuth.
- server.js v3: tenant routing, per-tenant CORS, 401 unknown key, per-tenant received counts.
- scripts/provision_site.py: onboard site (workspace+key+ES index+registry upsert, idempotent).
- deploy/MULTITENANT_ADMIN_AUTH.md: OIDC multi-tenant, workspace-scoped RBAC (Authentik self-host sketch).
- tests/isolation_test.js: LOCAL 12/12 PASS (no cross-tenant leak, 401, per-tenant CORS).
FIXED agent gaps: registry name/method mismatch (tenant-registry->registry; added size/originAllowedAny/
tenantOriginAllowed/forwardAuth). tenants.json gitignored; tenants.example.json shipped.
Local stand: index-aware mock-ES (/tmp/mock_es_idx.js filters by properties.testMarker) + 2-tenant tenants.json.
Prod still single-tenant v2; multi-tenant needs permanent Dittofeed + OIDC.

## THE remaining blocker — P0 permanent host (owner decision)
Box GostWheel 1.8GB free (ES+Odoo) — can't fit ~4GB Dittofeed. Oracle ARM not caught. Dittofeed LAPTOP-only
via cloudflared tunnel. Need host >=8GB. Then: docker compose -f deploy/docker-compose.cdp.yaml up ->
provision_site.py per site -> p1_load_all_triggers.py -> DITTOFEED_URL local on gateway -> loop 24/7 +
multi-tenant + OIDC admins. Also durability (Kafka/Redpanda F0-backbone or WAL) for zero-loss.
