# Test runbook — CDP dry-run for zavod.dev (local + tunnel)

Hosting decision (2026-06-19): **not deploying to a server yet** — run the CDP stack locally and
bridge the public storefront to the local `ingest-gateway` via a Cloudflare tunnel. ESP: **Mailgun
(via SMTP)** — Dittofeed has no native Mailgun connector, but Mailgun exposes SMTP and Dittofeed's
`Smtp` provider works with it.

```
zavod.dev (Vercel) --[zavod-track.js]--> cloudflared tunnel --> local ingest-gateway :8100
   --> Dittofeed (local) --> profile/segment --> broadcast/journey --> Mailgun SMTP --> seed inbox
```

## Prereqs to actually run (need from you)
- **Mailgun:** account + a sending domain (e.g. `mg.zavod.dev`), its SMTP creds
  (`smtp.mailgun.org:587`, `postmaster@mg.zavod.dev`, password), and DNS access to add Mailgun's
  SPF/DKIM/MX/CNAME records (required for "full dry-run" deliverability).
- **Storefront:** ability to add `zavod-track.js` to the aiml-mag Next.js app behind a feature flag,
  and redeploy (from pm99lvl).
- **Seed addresses:** 2-3 test inboxes (not real customers) to receive the dry-run.

## Steps

### 1. Boot CDP locally (~45s, data persists in volumes)
```bash
docker compose -f vendor/dittofeed/docker-compose.lite.yaml up -d
```

### 2. Run ingest-gateway
```bash
cd services/ingest-gateway && npm install
PORT=8100 DITTOFEED_API=http://127.0.0.1:3000 \
  WRITE_KEYS='{"wk_zavod":{"workspaceId":"<ws>","dittofeedWriteKey":"<base64(secretId:value)>"}}' \
  node_modules/.bin/tsx src/server.ts
```

### 3. Expose the gateway publicly (Cloudflare quick tunnel)
```bash
cloudflared tunnel --url http://localhost:8100
# -> prints https://<random>.trycloudflare.com  ==> this is the storefront endpoint base + /v1
```

### 4. Configure Mailgun as the Dittofeed email provider (via SMTP)
`PUT /api/admin/settings/email-providers` with
`config:{type:"Smtp", host:"smtp.mailgun.org", port:"587", username:"postmaster@mg.zavod.dev", password:"<mg-smtp-pass>"}`, `setDefault:true`.
(For pure pipeline testing without a domain, keep the local mailpit SMTP provider instead.)

### 5. Create the zavod.dev workspace assets
- Email template (zavod-branded MJML) using `{{ user.gen_subject }}` / `{{ user.gen_body_html }}`.
- User properties: `gen_subject`, `gen_body_html`, plus storefront traits (`company`, `region`, `interest`).
- Segment(s) from storefront behavior (e.g. viewed a category, abandoned cart).
- Welcome journey: entry on `identify` → wait → email (Flot-personalized content).

### 6. Wire the storefront tracker (behind a flag)
```js
import { createTracker } from './zavod-track';            // services/storefront-tracker/zavod-track.js
const track = createTracker({ endpoint: 'https://<tunnel>.trycloudflare.com/v1', writeKey: 'wk_zavod' });
track.page();
track.track('product_viewed', { sku, price, category });  // on PDP
track.track('add_to_cart', { sku, qty });
track.identify({ userId, email, company, region });        // on checkout / RFQ
```

### 7. Run the dry-run
Browse the storefront (flag on) → events arrive in Dittofeed → ml-content-worker generates content →
segment fills → welcome journey / broadcast sends via Mailgun → check seed inboxes + Dittofeed deliveries.

### 8. Tear down (free laptop)
```bash
docker compose -f vendor/dittofeed/docker-compose.lite.yaml down   # volumes kept
# stop cloudflared + the gateway process
```

## Industrial e-commerce event taxonomy (suggested)
`page_viewed` · `category_viewed` · `product_viewed` · `add_to_cart` · `checkout_started` ·
`rfq_submitted` (запрос КП) · `order_placed`. Identify traits: `email, company, inn, region,
industry, interest, last_category`.

## Caveats
- Local + tunnel = ephemeral: if the laptop sleeps or the tunnel drops, ingestion stops. Fine for a
  timed dry-run; not for continuous production (that needs the server decision, deferred).
- The CDP stack burns ~4GB RAM + ClickHouse CPU while up — boot only for the test, tear down after.
