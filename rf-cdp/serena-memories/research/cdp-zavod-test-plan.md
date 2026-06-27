# CDP test-deploy for zavod.dev — plan & hosting blocker (2026-06-19)

## Decisions
- Integrate CDP with zavod.dev storefront (aiml-mag, Next.js on Vercel). Goal: test-deploy / dry-run.
- ESP: **Mailgun** — Dittofeed has NO native Mailgun connector; use Mailgun via the **Smtp** provider
  (smtp.mailgun.org:587, postmaster@mg.zavod.dev, password).
- Scope: full dry-run (real domain/DKIM + welcome journey).
- Hosting: **deferred — run LOCALLY for now** (user: "пока не переносим на сервер, гоняем так").

## HOSTING BLOCKER (measured via SSH)
Vultr box `GostWheel` 137.220.56.211 (key ~/.ssh/commerce_os_deploy, root): **2 cores, 3.8GB RAM,
~1.6GB free**, 43GB disk free. Already runs: odoo-commerce-app, es-test (live zavod search),
odoo-commerce-db, amnezia-awg2 (VPN). CDP lite stack needs ~4GB -> **does NOT fit**; would OOM/risk
ES+Odoo. Nothing safe to stop. => can't co-host on the existing Vultr box.
When ready to go off-laptop: resize Vultr (8GB+), separate VPS, or Oracle ARM (capacity-gated).

## Local + tunnel test architecture
zavod.dev (Vercel) --zavod-track.js--> cloudflared tunnel --> local ingest-gateway :8100
  --> local Dittofeed --> profile/segment --> journey/broadcast --> Mailgun SMTP --> seed inboxes.
Local+tunnel = ephemeral (laptop sleep/tunnel drop stops it) — fine for a timed dry-run only.

## Prepared artifacts (in repo pm99lvl/CDP, commit 7526194)
- `services/storefront-tracker/zavod-track.js` — dependency-free browser tracker (identify/track/page),
  anon id in localStorage, keepalive fetch, no PII. To be added to the aiml-mag storefront behind a flag.
- `TEST_RUNBOOK_ZAVOD.md` — full local dry-run runbook (boot -> tunnel -> Mailgun SMTP -> workspace +
  welcome journey -> storefront snippet -> dry-run -> teardown) + industrial event taxonomy.

## Needed from user to actually run the dry-run
- Mailgun account + sending domain (mg.zavod.dev) SMTP creds + DNS access for SPF/DKIM/MX.
- Ability to add zavod-track.js to the aiml-mag Next.js app behind a flag + redeploy (from pm99lvl).
- 2-3 seed inbox addresses (not real customers; storefront is noindex/pre-launch).

Related: `mem:research/cdp-broadcast-orchestration`, `mem:research/cdp-suppression-verified`,
`mem:research/cdp-ingest-gateway-live`.
