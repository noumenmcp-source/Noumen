# Commercial Production Readiness — CDP-US

Audit by fact-of-code at main `f0ba9ba` (2026-06-27). US-only surface.
Severity to *commercial launch* (paying customers), not to "demo works".

Legend: ✅ done & verified · 🟡 partial · ❌ missing · 🔑 owner decision · S/M/L effort.

---

## 1. What exists and is verified

- **API surface** — 30 routes wired (`apps/api/src/routes/`), auth + RBAC +
  module-gate; public: `/v1/health`, `/v1/modules`, `/v1/signup`, `/v1/track`,
  `/v1/consent`. Modules: email, social-intel, automation, consent.
- **Platform/billing enforcement** — plan entitlements (402/403) + metered usage
  limits (`emailsPerMonth`), plan/status persisted, signup onboards on `free`.
- **Persistence** — all live-circuit stores Postgres-backed via `DATABASE_URL`:
  tenant, token, profile, ingest, audit, suppression, usage (monthly buckets).
  6 migrations apply clean on fresh PG (CI integration job).
- **Compliance primitives** — consent resolve (CCPA/CPRA + GPC), suppression
  list (CAN-SPAM), TCPA gate on messaging, DSAR access/correct, audit trail with
  emission on DSAR + module-enable.
- **Deploy artifact** — `apps/api/Dockerfile` builds; container boots, serves
  `/v1/health` 200, DB-backed `/v1/signup` persists (verified locally).
- **CI** — build-test + integration(real PG) green on every push. 72 test files.

---

## 2. Blockers to charging real customers

| # | Gap | Sev | Effort | Notes |
|---|-----|-----|--------|-------|
| B1 | **No payment provider.** Billing *enforces* tiers but cannot *charge*. No Stripe/checkout/subscription lifecycle, no upgrade flow. | ❌ blocker | L 🔑 | The revenue mechanism itself. Stripe Billing + webhook → set tenant `plan`. |
| B2 | **DSAR delete is a plan, not an execution.** `planDeletion` returns targets; nothing purges data. CCPA/CPRA right-to-delete is legally mandatory. | ❌ blocker | M | Add execute path: redact/tombstone profile + delete events/consent rows; audit it. |
| B3 | **Consent ledger is in-memory.** `applyConsentState` writes a module-level Map; `consent_records` table exists but is unused. Consent proof is lost on restart. | ❌ blocker | L | Sync `isAllowed` gate must go async + DB-backed (ripples through ingest/email/automation). |
| B4 | **No live environment.** AWS ECS Terraform (`infra/`) + Fly.io runbook exist but were never applied. No US Postgres provisioned, no domain, no TLS. | ❌ blocker | M 🔑 | Pick Fly.io (fast) vs AWS ECS (Terraform ready). Needs cloud creds + approval. |

---

## 3. Needed for a trustworthy production service

| # | Gap | Sev | Effort | Notes |
|---|-----|-----|--------|-------|
| P1 | **Auth is paste-an-API-token.** Console `/login` has no real auth; comment: "token introspection endpoint is not available yet." No password/session/reset, no OIDC. | 🟡 high | L 🔑 | Self-serve needs real login. Sales-led onboarding can defer. |
| P2 | **No observability.** No Sentry/OTel/metrics; only stdout pino logs. Can't see errors/latency in prod. | 🟡 high | S–M | Sentry (errors) + OTel/healthz minimum before launch. |
| P3 | **No tenant DB isolation (RLS).** Isolation is app-level only (path tenantId + RBAC). One query bug = cross-tenant leak. | 🟡 high | M | Postgres RLS or per-tenant query guards + a leak test. |
| P4 | **Email deliverability not provisioned.** `ResendSender` gated on `RESEND_API_KEY`; needs Resend account + verified domain + SPF/DKIM/DMARC DNS + double-opt-in. | 🟡 high | M 🔑 | Code helpers exist (`deliverability`); this is ops/DNS. |
| P5 | **No graceful shutdown.** No SIGTERM handler → in-flight requests dropped on every deploy/rollout. | 🟡 med | S | `app.close()` on SIGTERM/SIGINT. |
| P6 | **Rate-limit is in-process.** `@fastify/rate-limit` default memory store; limits diverge across replicas. | 🟡 med | S | Redis store when scaling past 1 instance. |
| P7 | **Secrets surface tiny.** Only `DATABASE_URL/PORT/RATE_LIMIT*`. Prod adds Resend/Stripe/auth secrets — need a secrets path (Terraform `secrets` module exists, unused). | 🟡 med | S | |

---

## 4. Console / self-serve UX (revenue funnel)

Console pages: `/login /signup /connect /modules /profiles /profiles/[id]
/activation{,/analytics,/audiences,/destinations,/journeys}`. Admin back-office:
`/tenants /tenants/[id] /suppression /audit`.

- 🟡 No billing/upgrade/usage UI (depends on B1).
- 🟡 No pages for many wired APIs (attribution, funnels, cohorts, lead-scoring,
  data-quality, forms, deliverability, DSAR self-service).
- ✅ Connector install snippet flow (`/connect` → `trackerSnippet(writeKey)`).

---

## 5. Recommended critical path to first paying customer

Sales-led MVP (fastest revenue; defers self-serve auth):

1. **B4 deploy** → live US env (Fly.io + US Postgres + domain/TLS). M
2. **P4 email** → Resend + verified domain (the sellable module). M
3. **B2 DSAR-delete** + **B3 consent-persist** → legal must-haves before storing
   real customer PII. M+L
4. **P2 observability** + **P5 shutdown** → safe to run. S
5. **B1 Stripe** → charge. Manual plan-set can bridge the very first deals. L
6. **P1 real auth** + console billing UI → true self-serve. L

Then P3 RLS, P6 Redis as scale demands.

🔑 **Open owner decisions:** payment provider (Stripe assumed); host (Fly.io vs
AWS ECS); self-serve vs sales-led first; who provisions cloud + DNS creds.
