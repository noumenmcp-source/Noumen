# CDP Phase 2 — Architecture (FINAL, 2026-06-19)

Phase 1 (MVP) is live. Phase 2 goal: maximally high-quality email marketing
(deliverability × relevance × timing × measurability × trust), multi-tenant agency (1 site = 1 workspace).

This is the final architecture after the lawyer rulings + the IP-jurisdiction check. It supersedes the
earlier v1/v2/v3 drafts (Beget-VPS, becheyqh-registry, ГОСТ-СКЗИ, token-boundary-for-legality) — all of
which collapsed once one fact landed: **the CDP box is already a Beget server in Russia.**

## The fact that simplified everything
`90.156.170.63` → **Beget LLC, Russia, St. Petersburg (AS198610), root + Docker.** The CDP stack already
runs in RU jurisdiction. So data-localization is already satisfied — nothing to migrate.

## Decisions (locked)
- **D1** — Multi-tenant agency from day one (workspace_id = real key boundary).
- **D2 (lawyer R1)** — **No cross-border transfer.** No ст.12 regime, no US ESP. **ESP = RU/EAEU only.**
- **D3 (lawyer R2)** — Pseudonymized tokens ARE personal data → **ALL personal data stays in RF.** Already
  true: everything runs on the Beget RU box. Foreign cloud only for genuinely NON-personal.
- **D4 (lawyer R3)** — **Certified ГОСТ СКЗИ NOT required (lawyer's position).** Use ordinary AES-256-GCM.
  No attestation/СКЗИ burden. This is the lawyer's call, not a risk-against-counsel.
- **D5** — **Exactly one Beget server for CDP = `90.156.170.63`.** No new servers. RAM relief = upgrade
  THIS box's plan + offload non-personal to cloud. `becheyqh` (the S8 152-ФЗ project) is SEPARATE and NOT
  part of CDP.
- **D6** — Erasure = plain `DELETE` of the PII row (our own DB; no no-delete constraint on CDP data).
- **D7** — Start with 2A (deliverability + durability + RU-ESP swap).

## Topology

### In RF — on the single Beget box `90.156.170.63` (root + Docker, AES)
ALL personal data + the engine live here. No cross-border.
- Postgres (Dittofeed profiles), Elasticsearch (`cdp_events`), ClickHouse, Dittofeed EE (multi-tenant),
  Temporal, ingest-gateway, Dex (OIDC).
- Event backbone (Redpanda) — events carry PII → stays here in RF.
- PII at rest encrypted with AES-256-GCM (app-layer for sensitive fields); TLS in transit (Caddy).
- RU/EAEU ESP for sending (candidates: Unisender Go, Mailopost, Sendsay, DashaMail) behind a swappable
  relay — real recipient address never leaves RF.

### Foreign cloud — NON-personal only (the zavod.dev model, already in place)
- Catalog (Cloudflare Worker `aiml.pm99lvl.workers.dev` + R2) — product data, no PII.
- Template bodies / MJML compile — placeholders only, no PII.
- Static frontend, truly-anonymous aggregate metrics.
- Observability (Grafana Cloud) — metrics with no PII labels.
Nothing personal (incl. tokens) goes here.

### Tokenization — optional, NOT load-bearing for legality
Since the engine is in RF, tokens no longer need to leave the country, so the RU-tokenization boundary is
no longer required for compliance. Keep pseudonymization only as defense-in-depth (data minimization,
breach containment) where cheap; not a hard requirement.

## What this removes vs the earlier drafts
- ✂️ No Beget VPS, no becheyqh PII registry, no separate RF host — one existing Beget RU box does it all.
- ✂️ No ГОСТ-СКЗИ, no attestation, no certified-crypto stack — AES is fine (lawyer).
- ✂️ No token-boundary-for-legality, no envelope-encryption-for-cross-border, no US-transfer paperwork.
- ✂️ The "active exposure" (raw email/IP off a jurisdiction-unconfirmed box) DISSOLVES — the box is RF.

## RAM — UPGRADE APPROVED (owner decision 2026-06-19)
Trilemma resolved by lifting the "no RAM upgrade" constraint: the full engine (ES+ClickHouse+Temporal+
Dittofeed) is KEPT (the OSS Postgres-core redesign was rolled back — capability loss unacceptable). The box
already OOM-killed ES at 766/768, so the upgrade is mandatory before stacking multi-tenant + Redpanda.
**Owner ceiling: MAX 6 GB** (not 8/16). Budget on 6 GB (~700 MB OS/Docker → ~5.3 GB for containers):
ES ~1.0-1.2 GB (heap 384m→512m to stop OOM) · ClickHouse ~1.0 GB · Dittofeed ~0.6-1.0 GB · Redpanda
~0.5-1.0 GB (capped) · PG/Temporal/gateway/Caddy/Dex ~0.7-1.0 GB → total ~4.5-5.3 GB. **Fits with moderate
headroom.** What 6 GB buys: full stack alive, OOM closed, Redpanda fits, single-tenant + a FEW tenants.
What it does NOT buy: many high-traffic tenants, heavy interactive OLAP at scale. RAM-2 / M1 = order the
6 GB upgrade (owner billing action), then raise ES heap.
IMPLICATION for multi-tenancy: on 6 GB, one-lite-instance-per-tenant barely scales (~0.5 GB each → 3-4 max);
a single EE instance is more RAM-efficient for many tenants but is PAID. So at 6 GB the sub-decision is:
EE (paid, for tenant density) vs accept "few tenants" on free lite instances. Decide at the OIDC step.

## Phase 2 quality pillars (unchanged — the actual goal)
- Deliverability: SPF/DKIM/DMARC→reject, BIMI, marketing/transactional domain split, shared-IP + RU-ESP
  reputation, suppression/bounce handling, engagement-based sending.
- Durability: Redpanda backbone (no event loss), DLQ, observability.
- Intelligence: computed traits/predictive (RFM, churn, propensity), send-time optimization.
- Content: AI generation via the Флот fleet + LLM-judge QA, catalog-driven recs. (Prompts with a name =
  PII → run gen in RF or template with placeholders resolved in RF.)
- Orchestration: journeys = our demo profiles (abandoned cart, reactivation, B2B account, win-back,
  post-purchase), frequency capping, holdout groups.
- Measurement: revenue attribution closing the loop into Profile + Delivery tiers.

## Rollout 2A (ordered)
0. Rotate the becheyqh/server creds exposed in chat; pick the RU/EAEU ESP.
1. Swap Resend → RU ESP behind the relay; re-verify the send loop end-to-end (test send, message id logged).
2. Deliverability hardening: SPF/DKIM/DMARC→reject + BIMI; split marketing vs transactional domains;
   wire RU-ESP bounce/complaint webhooks → suppression; engagement tiers.
3. Durability: Redpanda backbone on the RF box (events → topic → ES sink + Dittofeed forwarder), DLQ.
4. OIDC multi-tenant admin login (Dex — design ready in `deploy/oidc/`).
5. Upgrade the Beget box RAM plan; move the genuinely non-personal plane fully to cloud (catalog already
   there; add template render / observability / static).
6. AES-at-rest for PII fields (Postgres/ES); confirm TLS on every hop.
7. Then 2B (intelligence + AI content) and 2C (experiments + attribution loop).

## Open items
- Pick the RU/EAEU ESP (deliverability + API + 152-ФЗ posture) — selection workflow pending.
- **Multi-tenant mechanism** (sub-decision, decide at the OIDC step): Dittofeed multi-tenant = the EE
  (PAID) image. Options: (a) buy EE; (b) one Dittofeed-lite (MIT, free) instance PER tenant — now feasible
  on the upgraded box; (c) defer multi-tenant, run single-tenant (zavod.dev) on lite first. Owner lifted the
  RAM constraint, NOT necessarily the paid-software one — so (b)/(c) keep it free.
- Beget box upgrade tier — APPROVED; pick 8 GB (floor) vs 16 GB (if high-traffic tenant / heavy OLAP).

See `deploy/MULTITENANT_ADMIN_AUTH.md`, `deploy/oidc/OIDC_RAM_FIT_DESIGN.md`,
`mem:research/cdp-phase2-architecture`, `mem:research/cdp-golive-prod-confirmed`.
