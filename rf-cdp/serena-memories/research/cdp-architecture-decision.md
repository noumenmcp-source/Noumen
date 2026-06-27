# CDP architecture decision (locked 2026-06-19)

Supersedes the open questions in `mem:research/cdp-implementation-strategy` with a concrete variant.

## Product
Agency-sold **ML email marketing**. CDP = substrate that makes the email good.
Wedge = personalized LLM content per recipient at ~zero marginal cost via the **Flot** LLM fleet
(OpenAI-compatible gateways, see Flot Serena project `mem:fleet_backends`).

## Locked variant (user-confirmed)
- **Tenancy:** central multi-tenant SaaS we host (not per-client self-host).
- **Email/engagement base:** **Dittofeed** (fork-and-build).
- **ML at MVP:** LLM content generation via Flot only (scoring/send-time are later stages).

## Core principle — "fast quality"
Don't BUILD a CDP. **Compose commodity OSS, build only the spine.**
- Build (your code): unified profile/identity + ML-content worker + thin glue. That's it.
- Compose (OSS): ingest, email engine, sending, analytics, workflows.
Key insight: **Dittofeed IS the profile+segment store on day 1** (workspace = tenant,
identify-traits = profile, track-events = behavior). A *separate* CDP spine only earns its
place at multi-source identity resolution = Stage 2. So "quality CDP" at start = a correctly
configured Dittofeed workspace, not a separate build.

## Send flow (Flot content -> inbox), decoupled pre-generation
1. Campaign (control-plane) defines segment + brief.
2. ML-worker pulls audience from Dittofeed (REST/Admin API).
3. Cluster into MICRO-SEGMENTS (not per-user -> bounds Flot calls); Flot generates K variants.
4. **Content validator** (length, merge-tag integrity, spam words, link check) — unvalidated LLM
   output NEVER ships. This is the quality gate.
5. Worker writes back via **Identify API** as traits: gen_subject, gen_body_html, gen_variant, gen_campaign_id.
6. Dittofeed template interpolates `{{ user.gen_subject }}` etc -> journey/broadcast -> provider -> inbox.
7. open/click/bounce -> webhook -> back into profile traits (feedback loop).
Your only custom services at MVP: **ingest-gateway + ml-content-worker**.

## Dittofeed verified facts (docs + GitHub API, 2026-06-19)
- Stack: TypeScript on **Postgres + ClickHouse + Temporal** (optional Kafka). Multi-tenant auth mode + workspaces.
- Events -> ClickHouse; worker polls, updates segments/user-properties, signals journeys (Temporal), persists to Postgres.
- REST API + Admin API; SDKs web/node/react-native. White-label (domain/logo/theme) + Embedded Components.
- Providers: SES, Postmark, SendGrid, Resend.
- **License: MIT** (clean for SaaS resale).
- ⚠️ CAVEAT: default branch ~dormant — last commit 2026-03-27, only 1 commit in last 90 days, 2808 stars.
  Mitigation: MIT -> fork and own; core is mature. Verify upstream liveness before deep coupling.

## License rules for SaaS resale (verified via GitHub SPDX where noted)
- MIT/Apache -> free to resell. Our stack: Dittofeed (MIT), Temporal (MIT, already inside Dittofeed), umami (MIT).
- AGPL-3.0 -> self-host ok; central SaaS must offer source over network. (listmonk 21.6k, plausible 27k.)
- fair-code (n8n, Sustainable Use) / Elastic v2 (rudder-server) / SSPL / BSL -> managed-service restricted = RED for resale.
- open-core (PostHog /ee, Novu enterprise) -> core ok, enterprise dir needs commercial license.
- Tracardi: 642 stars + custom license -> do NOT use as base.

## Staged plan
- Stage 0 (days, sellable): Dittofeed via docker-compose (PG+CH+Temporal+app/worker), 1 workspace/client,
  connect SES/Resend, ml-content-worker (Flot -> Identify), white-label dashboard. No separate CDP DB.
- Stage 1 (weeks): thin ingest-gateway in front (site events -> Track API); control-plane over workspaces
  via Admin API; deliverability hardening (per-tenant domain + DKIM/SPF/DMARC, SES SNS bounce/complaint -> suppression).
- Stage 2 (when needed): own Postgres CDP spine (profiles/identifiers/events + RLS tenant_id, deterministic
  identity merge) for cross-source identity; predictive scoring; own analytics.

## What to take ("забрать и строить")
```
fork  dittofeed/dittofeed  (MIT)  — base
  + Temporal (MIT)                — inside Dittofeed
own   ingest-gateway              — site events -> Track API
own   ml-content-worker           — Flot -> validator -> Identify API
take  umami-software/umami (MIT)  — web analytics
svc   SES / Resend                — sending provider (not OSS)
```

## Deploy fit
Docker Compose stack; fits Oracle Always Free ARM (`mem:` global project_oracle_gostwheel) or small VPS.
Local dev box: MBP M1 Pro 16GB — PG+CH+Temporal+Dittofeed is heavy but runnable.

Related: `mem:research/cdp-thesis`, `mem:research/cdp-repo-shortlist`, `mem:research/cdp-email-architecture`, `mem:research/cdp-market-map`.
