# CDP — White-label AI email marketing on a self-hosted CDP

A composable, resale-safe customer platform: site/app events → unified profiles →
per-recipient **AI-generated** email content (via an LLM fleet) → segments → broadcasts →
delivery. Built to be sold by an agency as a white-label managed service.

> **Status: ~85% of the full target architecture.** Core loop proven end-to-end live; a permanent
> ingest-gateway is deployed; a white-label template engine (brand = theme; zavod = one instance) is built;
> all 21 triggers (templates + segments + journeys) are loaded into Dittofeed; the Resend brand domain
> `mail.zavod.dev` is verified (sends to any address).
> Current state & next steps → **[ROADMAP.md](ROADMAP.md)** · live infra & ops → **[DEPLOYMENT.md](DEPLOYMENT.md)**
> · trigger taxonomy → **[TRIGGER_MAP.md](TRIGGER_MAP.md)**.

## Principle — "fast quality"

Don't *build* a CDP. **Compose mature OSS for the commodity layers; write only the spine.**
- **Build (our code):** `ingest-gateway`, `ml-content-worker` (Flot content + quality gate).
- **Compose (OSS, MIT/Apache — resale-safe):** Dittofeed (engagement+email, MIT, base), Temporal,
  ClickHouse, Postgres; later umami (analytics), Jitsu (ingest), Qdrant (vectors).
- Dittofeed *is* the profile+segment store at MVP; a dedicated CDP spine (Apache Unomi vs custom)
  only earns its place at multi-source identity (Stage 2).

## Architecture loop

```
site/app → ingest-gateway → Dittofeed profile (ClickHouse)
   → ml-content-worker: Flot generates per-recipient content → Validator gate → write traits back
   → segment (computed) → broadcast → per-recipient Liquid render → SMTP/ESP → inbox
   → engagement (open/click/bounce) → profile  (feedback loop)
```

## Repo layout

| Path | What |
|---|---|
| `services/ingest-gateway` | Fastify event gateway (TS): `/v1/{identify,track,batch}` → Dittofeed Track API |
| `services/ml-content-worker` | Python worker: pull audience → cluster → Flot generate → `Validator` gate → write traits |
| `services/dittofeed-assets` | Flot-generated MJML email template + Liquid subject |
| `scripts/` | Orchestration: boot stack, fleet dispatch, full-role build, ML loop, broadcast |
| `.serena/memories/research/` | Design decisions, verified runtime facts, hard-won API recipes |

## What's proven (live, measured)

- **Dittofeed lite stack** boots (Postgres + ClickHouse + Temporal + app) — `scripts/boot_dittofeed_lite.sh`.
- **ingest-gateway** live on :8100 → identify/track forwarded → events land in ClickHouse; bad key → 401.
- **ML loop** — Flot (qwen3.7-max via the local fleet) generates distinct per-user subject+body;
  the worker's `Validator` gate enforces length / spam / link / merge-tag-balance; traits written via Identify.
- **Email** — Flot MJML template + user properties + SMTP provider → rendered, personalized email delivered
  (verified in mailpit: per-recipient subject + body).
- **Native orchestration** — segment (`audience=industrial`, computed) → broadcast v2 → 3 personalized
  emails to the 3 segment members.

## Run (local dev)

Prereqs: Docker, Node 20+, Python 3.11, and a local OpenAI-compatible LLM endpoint (the "Flot" fleet).

```bash
# 1. Dittofeed base (MIT) — cloned locally, not vendored in this repo:
git clone --depth 1 https://github.com/dittofeed/dittofeed.git vendor/dittofeed
bash scripts/boot_dittofeed_lite.sh          # pulls images, boots, health-checks :3000

# 2. ingest-gateway
cd services/ingest-gateway && npm install
PORT=8100 DITTOFEED_API=http://127.0.0.1:3000 \
  WRITE_KEYS='{"wk_test":{"workspaceId":"<ws>","dittofeedWriteKey":"<base64(secretId:value)>"}}' \
  node_modules/.bin/tsx src/server.ts

# 3. end-to-end ML loop + broadcast
python3 scripts/cdp_ml_loop.py
python3 scripts/cdp_broadcast.py && python3 scripts/cdp_broadcast2.py
```

The Dittofeed Admin API recipe (minting an admin key, schemas, gotchas) is documented in
`.serena/memories/research/cdp-dittofeed-admin-recipe.md`.

## Licensing note (why these OSS, for resale)

Only permissive-licensed OSS is in the critical path: **Dittofeed (MIT)**, Temporal (MIT), ClickHouse
(Apache-2.0), umami (MIT), Jitsu (MIT), Qdrant (Apache-2.0). Rejected for managed-SaaS resale:
RudderStack (Elastic v2), Airbyte (Elastic v2), Snowplow (Limited-Use), n8n (fair-code),
listmonk/Plausible (AGPL). Klaro rejected as dormant.

## Remaining for Stage-0 (100%)

Credential-gated: multi-tenant (OIDC provider), production ESP (SES/Resend + domain/DKIM).
Code polish: zod runtime validation in the gateway, sklearn micro-segmentation in the worker,
deliverability hardening (suppression / unsubscribe / double-opt-in).

> Dev write keys in `scripts/` belong to an ephemeral local Dittofeed instance and are regenerable —
> not production credentials.
