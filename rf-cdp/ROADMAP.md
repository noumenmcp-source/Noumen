# CDP — state & roadmap (updated 2026-06-19, session 2)

White-label AI email-marketing platform on a self-hosted CDP. **Templates are brand-agnostic; a brand =
a theme + campaign profile. zavod.dev is one instance.**

## State: ~85% of target · core loop proven live · permanent ingest deployed · 21 triggers in Dittofeed · brand domain verified

### Proven end-to-end (live)
`site event → ingest-gateway → profile → ml-content-worker (Flot + Validator) → segment → broadcast/journey
→ branded render (real catalog images) → Resend → inbox`, unsubscribe honored, welcome journey auto-fires.

### Built & verified
- **Production ingest-gateway — DEPLOYED PERMANENT:** `https://cdp.137-220-56-211.sslip.io/v1` (caddy + LE,
  systemd Restart=always, raw→ES `cdp_events`, async 204 ack, CORS echo + *.vercel.app, retry/DLQ). No more 530.
  Code: `services/ingest-gateway-prod`. Detail: `.serena/memories/research/cdp-gateway-deployed`.
- **White-label email engine:** `templates/master-marketing` + `master-transactional` (tokenized, premium,
  MSO/mobile, white CTA); `themes/themes.json` (zavod + retail "Verdé" — brand-agnostic proven);
  `campaigns-catalog.json` (21 trigger scenarios); `scripts/compile_email.py` (theme × master × campaign → email).
- **ml-content-worker:** clustering + Validator gate + run-loop + per-profile catalog showcase + suppression; tests green.
- **Dittofeed:** workspace-as-code, segments, broadcast, **welcome journey (Running)**, suppression — all live-verified.
- **All 21 triggers loaded into Dittofeed (session 2):** 21 templates + 21 segments + 21 journeys (all `Running`),
  via `scripts/p1_load_all_triggers.py` (idempotent, uuid5 IDs). Verified 63/63 PUT 2xx + API list (24 templates,
  23 journeys Running). Gotcha: journey entryNode type is `"EntryNode"` (not `"SegmentEntryNode"`).
- **Resend brand domain `mail.zavod.dev` — VERIFIED (session 2):** DKIM + SPF + MX added to GoDaddy DNS,
  propagated (DoH-confirmed), Resend status `Verified`. Sends now go from `hello@mail.zavod.dev` to ANY address.
  GoDaddy gotcha: 3-record batch "Save All" fails silently; save records ONE AT A TIME (each → "Success" toast).
- **Storefront endpoint cut over to permanent gateway (session 2):** `NEXT_PUBLIC_CDP_ENDPOINT` =
  `https://cdp.137-220-56-211.sslip.io/v1` (Vercel preview, via REST API). cloudflared tunnel 503-on-browser
  diagnosed + abandoned; permanent caddy domain serves browser traffic 204 (CORS verified). Preview redeployed.
- Universal `TRIGGER_MAP.md` (A onboarding … E retention).

### Honest gaps
- **Dittofeed permanent hosting — THE blocker.** Box can't fit ~4GB (1.8GB free). Until resolved, the permanent
  gateway runs RAW-ONLY (events→ES); Dittofeed profiles update via the laptop tunnel during the test window.
  The 21 triggers live on the laptop Dittofeed; they persist permanently only once Dittofeed has a permanent home.
- Storefront flag flip + full acceptance #2/#3 — in the dev's hands (tracker deployed, endpoint now permanent).
- Per-profile showcase is section-level (no product-level endpoint on the catalog worker); webp→png via proxy.
- Email-image format webp (proxied to png); no CI/dockerize of services.

## Roadmap — next

**P0 — decision (yours):** Dittofeed permanent home (resize Vultr 8GB / new VPS / Oracle ARM). Unblocks full
permanence (set DITTOFEED_URL on the box → permanent gateway forwards → profiles update without the laptop).

**P1 — build now (no creds):**
1. ✅ DONE (session 2) — 21 trigger templates + segments + journeys loaded into Dittofeed.
2. Wire event-entry journeys (real event triggers vs current trait-entry segments) once storefront events flow in.
3. ✅ DONE (session 2) — CI (`.github/workflows/ci.yml`) + dockerized gateway (`Dockerfile`, build verified) +
   whole-stack `deploy/docker-compose.cdp.yaml` + `deploy/DEPLOY_DITTOFEED_PERMANENT.md` runbook +
   email webp→png proxy + Resend bounce/complaint webhook (`POST /v1/resend-webhook`→suppression).
   Loop closes the moment Dittofeed gets a permanent host (P0).

**P2 — user-gated:**
- ✅ DONE (session 2) — Resend domain `mail.zavod.dev` verified; sending to any address from `hello@mail.zavod.dev`.
- Storefront flag flip + acceptance #2/#3 (dev) — endpoint already cut over to the permanent gateway.

**P3:** multi-tenant (OIDC); product-level personalization; bounce/complaint feed + double-opt-in.

Memories: `mem:audit/state_2026_06_19`, `mem:research/cdp-gateway-deployed`, `mem:research/cdp-journey-recipe`,
`mem:research/cdp-broadcast-orchestration`, `mem:research/cdp-suppression-verified`, `mem:research/cdp-zavod-test-plan`.
