#!/usr/bin/env python3
"""Seed a Noumen demo tenant with realistic synthetic B2B SaaS profiles.

Generates ~N profiles, each an `identify` plus a decaying acquisition funnel of
`track` events, with historical timestamps spread over the last 30 days so the
console's analytics (funnel / retention / time series) render real shapes — not
flat bars. Events post to the public `/v1/track` endpoint in batches of 500.

Usage:
    NOUMEN_WRITE_KEY=wk_us_... \\
    NOUMEN_API=https://noumen.<host>.sslip.io \\
    python3 scripts/seed-demo.py [N]

The write key comes from the tenant created via `POST /v1/signup`
(`tenant.writeKey`). Never commit a real write key — pass it via the environment.
"""
import json
import os
import random
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

API = os.environ.get("NOUMEN_API", "http://127.0.0.1:8210").rstrip("/") + "/v1/track"
WRITE_KEY = os.environ.get("NOUMEN_WRITE_KEY")
N = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("SEED_N", "20000"))
SEED = int(os.environ.get("SEED", "42"))
WINDOW_DAYS = 30

if not WRITE_KEY:
    sys.exit("NOUMEN_WRITE_KEY is required (tenant.writeKey from /v1/signup)")

random.seed(SEED)
# Anchor "now" to the wall clock; the dataset spans the trailing WINDOW_DAYS.
NOW = datetime.now(timezone.utc)

INDUSTRIES = ["Manufacturing", "SaaS", "Fintech", "Healthcare", "Retail", "Media", "Logistics", "Education"]
CHANNELS = [
    ("paid_search", 0.18), ("linkedin_ads", 0.17), ("organic_search", 0.16),
    ("email", 0.14), ("webinar", 0.12), ("partner_referral", 0.12), ("direct", 0.11),
]
DEVICES = [("desktop", 0.42), ("mobile", 0.34), ("tablet", 0.24)]
BROWSERS = {
    "desktop": ["Chrome", "Edge", "Firefox", "Safari"],
    "mobile": ["Safari", "Chrome", "Samsung Internet"],
    "tablet": ["Safari", "Chrome", "Samsung Internet"],
}
OS = {
    "desktop": ["macOS 15", "Windows 11", "ChromeOS"],
    "mobile": ["iOS 18", "Android 14"],
    "tablet": ["iPadOS 18", "Android 14"],
}
STATES = ["CA", "NY", "TX", "IL", "WA", "MA", "CO", "FL", "GA", "NC", "PA", "OH", "MI", "AZ", "VA"]
EMP = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001-5000", "5000+"]
REV = ["$1M-10M", "$10M-50M", "$50M-250M", "$250M+"]
PLAN = ["starter", "growth", "scale", "enterprise"]

# Ordered funnel with cumulative conversion vs the first step.
FUNNEL = [
    ("Product Viewed", 1.00, "/product"),
    ("Pricing Viewed", 0.56, "/pricing"),
    ("Plan Compared", 0.40, "/pricing/compare"),
    ("Demo Requested", 0.27, "/demo"),
    ("Trial Started", 0.15, "/trial"),
    ("Checkout Started", 0.092, "/checkout"),
    ("Upgrade Clicked", 0.064, "/account/upgrade"),
]


def weighted(pairs):
    r = random.random()
    acc = 0.0
    for val, w in pairs:
        acc += w
        if r <= acc:
            return val
    return pairs[-1][0]


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def post_batch(events):
    body = json.dumps({"writeKey": WRITE_KEY, "events": events}).encode()
    req = urllib.request.Request(API, data=body, headers={"content-type": "application/json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except Exception:  # noqa: BLE001 — retry with backoff
            if attempt == 3:
                raise
            time.sleep(1.5 * (attempt + 1))


def main():
    batch, sent, stored = [], 0, 0
    t0 = time.time()
    for i in range(1, N + 1):
        anon = f"demo_anon_{i:05d}"
        industry = random.choice(INDUSTRIES)
        channel = weighted(CHANNELS)
        device = weighted(DEVICES)
        browser = random.choice(BROWSERS[device])
        osname = random.choice(OS[device])
        slug = industry.lower()
        domain = f"{slug}-{i:05d}.example.com"

        signup_dt = NOW - timedelta(
            days=random.randint(0, WINDOW_DAYS - 1),
            hours=random.randint(0, 23), minutes=random.randint(0, 59),
        )

        reached = 1
        for k in range(1, len(FUNNEL)):
            if random.random() < FUNNEL[k][1] / FUNNEL[k - 1][1]:
                reached += 1
            else:
                break
        lead_score = min(100, 12 + reached * 12 + random.randint(-6, 6))

        traits = {
            "firstName": f"Demo{i:05d}", "email": f"user{i:05d}@{domain}",
            "company": f"{industry} Co {i:05d}", "domain": domain, "country": "US",
            "state": random.choice(STATES), "industry": industry,
            "acquisitionChannel": channel, "deviceType": device, "browser": browser,
            "os": osname, "deviceId": f"device_{device}_{i:05d}",
            "employeeRange": random.choice(EMP), "revenueRange": random.choice(REV),
            "plan": random.choice(PLAN), "leadScore": lead_score,
            "syntheticDataset": "noumen-demo",
        }
        batch.append({"type": "identify", "anonymousId": anon, "userId": f"user_{i:05d}",
                      "traits": traits, "ts": iso(signup_dt)})

        ev_dt = signup_dt
        for k in range(reached):
            name, _, page = FUNNEL[k]
            ev_dt = ev_dt + timedelta(minutes=random.randint(2, 90))
            props = {"page": page, "plan": traits["plan"], "industry": industry,
                     "campaign": f"q2-{channel}", "referrer": channel, "deviceType": device,
                     "browser": browser, "os": osname,
                     "screenWidth": {"desktop": 1440, "mobile": 390, "tablet": 820}[device],
                     "syntheticDataset": "noumen-demo"}
            if name == "Checkout Started":
                props["value"] = random.choice([99, 299, 999, 2499])
            batch.append({"type": "track", "anonymousId": anon, "event": name,
                          "properties": props, "ts": iso(ev_dt)})

        if random.random() < 0.22:
            ev_dt = signup_dt + timedelta(hours=random.randint(1, 240))
            batch.append({"type": "track", "anonymousId": anon, "event": "Support Article Viewed",
                          "properties": {"page": "/help/getting-started", "deviceType": device,
                                         "syntheticDataset": "noumen-demo"}, "ts": iso(ev_dt)})

        while len(batch) >= 500:
            chunk, batch = batch[:500], batch[500:]
            res = post_batch(chunk)
            sent += len(chunk)
            stored += res.get("stored", 0)
        if i % 2000 == 0:
            print(f"  profiles {i}/{N}  sent={sent}  stored={stored}  {time.time()-t0:.0f}s", flush=True)

    while batch:
        chunk, batch = batch[:500], batch[500:]
        res = post_batch(chunk)
        sent += len(chunk)
        stored += res.get("stored", 0)

    print(f"DONE profiles={N} sent={sent} stored={stored} elapsed={time.time()-t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
