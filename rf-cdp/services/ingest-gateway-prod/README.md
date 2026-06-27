# CDP ingest-gateway (production)

Storefront events (POST /v1/track, /v1/identify) -> fast 204 ack -> async queue ->
raw to tenant-scoped Elasticsearch (`cdp_events_<site>`) + forward to that tenant's Dittofeed workspace
(Basic auth, retry/backoff, DLQ). CORS echoes an allow-listed Origin (wildcard `*.vercel.app`
supported). GET /v1/health -> counters.

RF ConsentOps receipt path: POST /v1/consent stores a tenant-scoped raw consent receipt in
`cdp_consent_<site>` and does not forward it to Dittofeed. This keeps RF legal proof/audit data
separate from marketing event flows.

## Run
    npm install
    cp .env.example .env   # edit
    node server.js

## Deploy (server behind caddy)
    rsync server.js package.json .env to /opt/cdp-gateway/ ; npm install --omit=dev
    cp cdp-gateway.service /etc/systemd/system/ ; systemctl enable --now cdp-gateway
    # caddy: cdp.<host>.sslip.io { reverse_proxy localhost:8110 }
Health: GET https://<domain>/v1/health
