# Production ingest-gateway DEPLOYED (permanent) — 2026-06-19

## URL
https://cdp.137-220-56-211.sslip.io/v1  (permanent, LE cert via caddy, systemd Restart=always).
Replaces the ephemeral cloudflared tunnel. No more 530.

## Where / how
- Box: Chicago "GostWheel" 137.220.56.211 (key ~/.ssh/commerce_os_deploy, root). Node 18.19, caddy 2.11.
- Service: /opt/cdp-gateway (server.js + package.json + .env), systemd unit `cdp-gateway` (enabled, port 8110).
  Code: repo services/ingest-gateway-prod (plain Node/Fastify/undici).
- caddy: appended block `cdp.137-220-56-211.sslip.io { reverse_proxy localhost:8110 }` to /etc/caddy/Caddyfile
  (backed up first, `caddy validate` then reload — graceful, did not disrupt odoo/admin.zavod.dev).
- ES index `cdp_events` on the box's existing es-test (127.0.0.1:9200). IMPORTANT: ES_URL must be
  http://127.0.0.1:9200 (NOT localhost — es-test binds IPv4 only; Node localhost->::1 fails).

## Verified end-to-end on the public URL
CORS echo-origin + *.vercel.app wildcard + Vary; /v1/track,identify -> 204; bad write-key -> 401; bad JSON -> 400;
fast 204 async ack; raw events land in ES cdp_events (count grows); /v1/health counters. ES failure graceful (counter).

## Current mode + remaining gap
DITTOFEED_URL is EMPTY on the box => RAW-ONLY (events stored in ES permanently; Dittofeed forward DISABLED).
Reason: Dittofeed runs on the laptop (ephemeral) and is NOT reachable from the box. The "forwarded" counter
increments as a no-op when forward is disabled — not real forwards.
=> For full acceptance incl Dittofeed profile (#3), the dev still uses the laptop tunnel (gateway->laptop
Dittofeed->ClickHouse). Permanent URL gives durable ingest+raw NOW; cut the dev over to it once Dittofeed has a
permanent reachable home (set DITTOFEED_URL + DITTOFEED_WRITE_KEY on the box, restart cdp-gateway).

## THE remaining blocker for full permanence
Dittofeed permanent hosting — box can't fit ~4GB (1.8GB free). Options: resize Vultr / new VPS / Oracle ARM.

Related: `mem:research/cdp-zavod-test-plan`, `mem:research/cdp-ingest-gateway-live`, `mem:audit/state_2026_06_19`.
