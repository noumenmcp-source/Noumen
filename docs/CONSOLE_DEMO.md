# Console demo workspace & operations cockpit

How the public console demo is wired: a populated read-only workspace, the
operations cockpit on the dashboard, and per-module capability pages.

- **UI:** https://console.137-220-56-211.sslip.io
- **API:** https://noumen.137-220-56-211.sslip.io
- Demo tenant: `Noumen Demo Workspace` (region `us`), seeded with ~20k synthetic
  B2B SaaS profiles and ~75k events.

## Demo mode

The dashboard and every `/capabilities/<key>` page are demo-aware via
`effectiveSession()` ([apps/console/src/session.ts](../apps/console/src/session.ts)):

1. a stored login (`localStorage`) wins if present and valid;
2. otherwise, if `NEXT_PUBLIC_DEMO_TENANT` and `NEXT_PUBLIC_DEMO_TOKEN` are set
   at build time, the page loads that read-only workspace so the public URL
   renders populated;
3. a **stale/invalid stored session that returns no data is cleared** and falls
   back to demo — it never bricks the public page.

These are `NEXT_PUBLIC_*` build args, inlined into the client bundle. Pass them
through the Docker build (see Deploy). **The embedded demo token must be
`analyst` role only** — `admin`/`owner` tokens can execute DSAR delete
(`POST /v1/tenants/:id/dsar { kind: "delete" }`) and would let any visitor wipe
the workspace.

## Operations cockpit ([apps/console/app/page.tsx](../apps/console/app/page.tsx))

Loads in two independent slices so a slow call never blanks the whole page:

- **core** — KPIs, 30-day event area chart, acquisition funnel
  (`analytics/funnel` + `analytics/timeseries`). Renders first.
- **breakdowns** — devices / channels / industries, computed client-side from a
  single `GET /profiles` read (one request instead of N per-segment audience
  scans). Fills in when ready.

`request()` ([apps/console/src/api.ts](../apps/console/src/api.ts)) has an 18s
`AbortController` timeout, so nothing hangs indefinitely.

## Capability pages ([apps/console/app/capabilities/[key]/page.tsx](../apps/console/app/capabilities/%5Bkey%5D/page.tsx))

Driven by the catalog in
[apps/console/src/capabilities.ts](../apps/console/src/capabilities.ts), which
mirrors the live API routes. Each tile on the dashboard links to its page,
showing the module summary, **real REST endpoints**, required role, and:

- a **live result** for modules cheap to read with an analyst token —
  `analytics` (funnel + retention), `cohorts` (retention), `audiences` and
  `attribution` (segment sizes);
- otherwise the endpoint + a `curl` sample (no fabricated data).

Access reality reflected in the UI: most non-analytics modules are billing-gated
(enable returns **HTTP 402**, e.g. `social-intel`, `email`, `automation`) or
require `admin` (`audit`, `deliverability`, `dsar`). The green "live" dot is only
shown for modules with a working demo.

## (Re)seed demo data

Create a tenant, then seed it. Never commit the write key.

```bash
# 1. create a demo tenant (returns tenant.writeKey + an owner apiToken)
curl -sX POST "$NOUMEN_API/v1/signup" -H 'content-type: application/json' \
  -d '{"companyName":"Noumen Demo Workspace","ownerEmail":"demo@noumen-demo.example"}'

# 2. seed ~20k realistic profiles + a decaying funnel over the last 30 days
NOUMEN_API=https://noumen.137-220-56-211.sslip.io \
NOUMEN_WRITE_KEY=wk_us_... \
python3 scripts/seed-demo.py 20000
```

See [scripts/seed-demo.py](../scripts/seed-demo.py).

## Deploy

The console builds from `/opt/noumen/repo` on the US host via Docker Compose
(not a git checkout — sync with `rsync`).

```bash
rsync -az --exclude node_modules --exclude .next \
  apps/console/ root@<host>:/opt/noumen/repo/apps/console/

# compose passes the demo build args (analyst token) to the Dockerfile:
#   NEXT_PUBLIC_API_URL, NEXT_PUBLIC_DEMO_TENANT, NEXT_PUBLIC_DEMO_TOKEN
ssh root@<host> 'cd /opt/noumen && docker compose build console && docker compose up -d console'
```

`noumen-api`, `noumen-postgres`, `noumen-redis` are not recreated by a console
deploy. Health counters in `GET /v1/health` are in-memory and reset on an API
restart; the dashboard derives its numbers from tenant analytics, not those
counters.
