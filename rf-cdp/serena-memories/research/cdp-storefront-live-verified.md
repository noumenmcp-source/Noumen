# CDP storefront → server LIVE-verified (2026-06-19)

Companion to `mem:research/cdp-server-deploy-live`. Storefront switched to the permanent server and
live-confirmed receiving.

## Storefront switched to new server
- Vercel (aiml-mag-web) NEXT_PUBLIC_CDP_ENDPOINT = https://cdp.90-156-170-63.sslip.io/v1 (Production+Preview).
- NEXT_PUBLIC_CDP_WRITE_KEY = wk_zavod. NEXT_PUBLIC_CDP_ENABLED = false (Production) / true (Preview).
- The zavod.dev team did the prod redeploy (dpl_DcupEsxd promoted, remote build not --prebuilt). New endpoint
  is baked into the bundle at build time (verified: new endpoint in static chunk, old 137-220-56-211 gone).
- CDP tracker code is ALREADY in main/prod (lib/cdp/*, *Tracker.tsx, track() calls behind the flag, try/catch).

## LIVE приём подтверждён с реального браузера (Preview, ENABLED=true)
Opened preview in a real browser, gave consent, clicked → event reached the NEW server:
received zavod 4→5, raw.stored 5, forward.forwarded 5 (local, no tunnel), raw_failed=0, dropped=0.
Full chain works on the permanent server: browser(consent=all) → POST /v1/track → server → ES + Dittofeed.

## CONSENT GOTCHA (storefront CookieBanner)
Consent saves to localStorage key `aiml.cookie-consent=all` ONLY if the "Я согласен" CHECKBOX is ticked
BEFORE clicking "Принять". Clicking "Принять" alone does NOT save consent → tracker stays NOOP
(consentGranted=false). Real users tick the box; but during testing, an un-ticked box = "not sending" is just
missing consent, NOT a server/integration fault. (Cost me a false "not sending" during the live test.)

## Network-tool caveat
chrome read_network_requests clears on navigation (SPA route changes / new page) — it often misses /v1/track.
Server-side /v1/health `received` is the reliable proof of receipt, not the browser network panel.

## Go-live remaining (owner decision)
Production ENABLED=false (tracker asleep on prod by design). Go-live = owner sets NEXT_PUBLIC_CDP_ENABLED=true
in Production + team redeploys. Then real zavod.dev visitors flow to the new server.
Also pending: rotate server password (exposed in chat) + rotate Resend key (in git history).
Old box 137.220.56.211 (old v2 gateway) can be retired now that prod bundle points to the new server.
