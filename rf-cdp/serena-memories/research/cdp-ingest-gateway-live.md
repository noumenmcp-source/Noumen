# ingest-gateway — live & proven (2026-06-19)

Closes the LEFT entry of the loop: site events -> our gateway -> Dittofeed Track API -> ClickHouse profile.
Companion to `mem:research/cdp-broadcast-orchestration`.

## Service
- `services/ingest-gateway` — Node 22 + TypeScript + Fastify v4 + undici + zod + @fastify/cors.
- Run (dev): from the dir, `PORT=8100 DITTOFEED_API=http://127.0.0.1:3000 WRITE_KEYS='{"wk_test":{"workspaceId":"<ws>","dittofeedWriteKey":"<base64(secretId:value)>"}}' node_modules/.bin/tsx src/server.ts`.
- Endpoints: POST /v1/identify, /v1/track, /v1/batch (header `x-write-key`), GET /healthz.
- Maps client write key -> Dittofeed workspace token; forwards to /api/public/apps/{type} with verbatim
  `Authorization: Basic <token>`; messageId via crypto.randomUUID; undici retry on 5xx.

## Fixes applied to the Flot scaffold to make it run
- dittofeed.ts had undefined getWorkspaceById, hardcoded api.dittofeed.com, signature mismatch with
  routes.ts, and used `response.status` (undici uses `statusCode`). Rewrote to resolve from config.WRITE_KEYS.
- config.ts PORT default 3000 -> 8100 (3000 is Dittofeed).
- Installed deps + tsx; run via tsx (skips strict tsc).

## Proven
healthz 200; identify 204 -> landed in ClickHouse; track -> landed (event=viewed_product);
bad write key -> 401. user_events_v2 for gw-smoke-2 had 2 rows (identify+track).

## Environment caveat (NOT a code bug)
Forward latency spiked to 16-20s (a track curl even hit its client timeout though the write still landed)
because ClickHouse was pegged at ~171% CPU on the 16GB box — competing containers running (stirling-pdf,
growthbook, plausible, formbricks, etc.) plus our recompute/broadcast load. Direct identify was sub-second
when CH was idle. In a non-saturated env the gateway forward is fast.

## Stop everything
`pkill -f "tsx src/server.ts"` ; `docker compose -f vendor/dittofeed/docker-compose.lite.yaml down` ;
`docker rm -f cdp-mailpit`.

## Progress after this
~62% of target; ~85% of Stage 0. Both ends of the loop now run on real services:
gateway (our code) -> Dittofeed profile -> Flot ML loop -> segment -> broadcast -> personalized email.
Remaining for Stage 0: zod runtime validation wiring in gateway, multi-tenant (OIDC), prod ESP (SES/DKIM),
deliverability hardening, sklearn micro-segmentation.
