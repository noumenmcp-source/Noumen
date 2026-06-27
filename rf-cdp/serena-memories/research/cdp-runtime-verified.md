# CDP runtime — verified facts (2026-06-19)

Live-tested findings from actually running the stack. Companion to `mem:research/cdp-architecture-decision`.

## Dittofeed boots and works (risk retired)
- `vendor/dittofeed/docker-compose.lite.yaml` brings up: dittofeed-lite (single app+worker) +
  postgres:15 + clickhouse:24.12 + temporalio/auto-setup:1.22.4. ~4GB RAM. Boots on M1 16GB.
- Despite default branch dormant (last commit 2026-03-27), image `dittofeed/dittofeed-lite:v0.23.0`
  **starts cleanly**: logs "Server listening at http://0.0.0.0:3000", Temporal worker created, ClickHouse bootstrapped.
- Boot script: `scripts/boot_dittofeed_lite.sh` (pull-loop + up + health). Network to docker registry
  is flaky here (TLS handshake timeouts on large blobs) — retried until it caught a calm window.
- Stop: `docker compose -f vendor/dittofeed/docker-compose.lite.yaml down` (volumes keep data).

## Dittofeed API contract (VERIFIED live + from container source)
- Public ingest/write: POST /api/public/apps/{identify,track,batch}. Auth =
  **`Authorization: Basic <writeKey>`** where writeKey = **base64(secretId:secretValue)** and secretId
  MUST be a valid uuid (checked in /service/packages/backend-lib/dist/src/auth.js `validateWriteKey`).
  Send the token VERBATIM — do NOT re-base64-encode it.
- identify body requires: userId, messageId (uuid), traits. Segment-compatible.
- Write traits back = same public identify endpoint (NOT /users/{id}/traits — that path is invented).
- Admin API: POST /api/admin/users exists (Bearer admin key); /api/admin/segments returned 404.
- Write key lives in Postgres: `WriteKey` -> `Secret(id, name, value)`. Default dev key:
  secretId from Secret.id, value e.g. `cb70604088581b20` -> token = base64("<secretId>:<value>").
- Templates interpolate traits via Liquid: `{{ user.gen_subject }}`.

## E2E proof (the whole write path works)
POST identify with Basic base64(secretId:value) + {userId, messageId, traits:{gen_subject, gen_variant}}
-> **HTTP 204**, and the event **landed in ClickHouse** `dittofeed.user_events_v2` with traits intact.
So: client -> /api/public/apps/identify -> Dittofeed -> worker -> ClickHouse, carrying our generated content.

## Custom services state (services/)
- `ingest-gateway` (TS/Fastify/undici): Dittofeed client fixed — Basic-verbatim auth, undici `request`,
  paths correct. Loose ends: `getWorkspaceById` helper undefined, DITTOFEED_API hardcoded to api.dittofeed.com
  (make configurable), not type-checked (no node_modules), no server run yet.
- `ml-content-worker` (Python/httpx/sklearn): dittofeed_client fixed — real endpoints, verbatim Basic,
  uuid4 imported; standalone `Validator` (incl. merge-tag balance) wired into `generator.py`. Python compiles.
  Not run e2e yet; clustering/flot_client untested against real audience.

## OSS scout report cross-check (2026-06-19, verified via GitHub API)
A scout report proposed adding Apache Unomi as a dedicated CDP from day 1. Verification:
- apache/unomi: Apache-2.0 (GREEN), maintained (23 commits/90d) BUT **only 360 stars, Java/Karaf/ES, weak
  multi-tenancy (scopes, not true isolation)**. -> Do NOT adopt at MVP. Candidate for Stage-2 CDP (adopt-vs-build),
  gated by a multi-tenancy spike. Contradicts "fast quality" if pulled in early (microservices-first trap).
- **kiprotect/klaro (report's consent "winner") is DORMANT**: last commit 2025-03-27, 0 commits/90d,
  license NOASSERTION. Do NOT use. Use Dittofeed subscription-groups or an active consent tool instead.
- Verified GREEN + active extras to cherry-pick by stage: jitsucom/jitsu (MIT, ingest), qdrant/qdrant
  (Apache-2.0, vectors when we add embeddings), hatchet-dev/hatchet (MIT, lighter Temporal alt).
- Report's license rejections (RudderStack ELv2, Airbyte ELv2, Snowplow Limited-Use, n8n fair-code,
  listmonk/OpenPanel/Windmill AGPL) match our own audit — trustworthy there.

## Readiness vs target (honest)
~35% of full target; ~46% of Stage 0. First working e2e slice exists (Dittofeed live + identify->CH proven).
Decision unchanged: Dittofeed-first, no Unomi/Kafka/Qdrant at MVP.
