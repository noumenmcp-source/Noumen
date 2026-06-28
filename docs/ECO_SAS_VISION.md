# ECO SAS — vision & Channel ROI Advisor (wedge v1)

> Stop guessing who your customer is — see them in 3D. ECO SAS is the eyes of
> marketing: it pulls data from everywhere, unifies it, and tells the client in
> plain words how to sell more and which channel is bleeding money — and why.
> It doesn't just advise — it **explains**, teaching a non-expert owner what
> their metrics even mean, which surfaces the next service package to buy.

## Three pillars

1. **Purpose — help the client sell.** The unit of value is *insight → action*,
   not dashboards. Every feature must answer: *did this move revenue / CAC /
   ROAS?* If not, it doesn't ship.
2. **Engine — take from everywhere, unify, explain, advise.** A CDP + marketing
   attribution + SEO intelligence + an AI analyst that narrates the numbers.
3. **Explain, don't just advise (the upsell flywheel).** A metric says "organic
   traffic" — a non-expert owner has no idea what that is or where it comes from.
   ECO SAS explains it in plain words: what it is, where it comes from, that
   growth needs SEO, how to analyze it. The education *surfaces a need* → the
   client buys the next package (SEO audit, attribution setup, a managed channel)
   → **average check (ARPU) grows**. Win-win: we grow ARPU; the client keeps a
   quality customer database and runs competent marketing. Every explanation and
   recommendation is **grounded in the client's own numbers and cites them** — an
   AI tutor over their data, not generic content.

### Honest framing of "3D"
True person-level 3D is only possible on **first-party** data (profiles, events,
enrichment, intent) — the Noumen core already does this. Ad-platform and GA data
are **channel/campaign aggregates** and usually can't be resolved to a person.
So the product lives on two planes: *3D on your own customers* + *an X-ray on
channels*. Never promise person-level where the data physically isn't.

## Validated positioning — "marketing ROI translator" (research verdict: GO)

US market research returns **GO — but as a narrow wedge, not another all-in-one
martech.** We are a **marketing ROI translator** for SMB / mid-market and the
agencies that serve them.

**Market (US) [fact, per research]:**
- US digital marketing software: $37.1B (2025) → $152.6B (2034).
- Attribution software (global): $5.3B (2025); North America 42.4%.
- CDP: $3.28B (2025) → $17.03B (2034).
- **Realistic starting SAM ≈ $0.6–1.8B/yr** [estimate] — US firms with ad spend
  + a revenue source + the "I don't understand my ROI" pain.

**The validated gap — not data, not SEO, but explanation.** Collecting data is
solved (Funnel, Supermetrics, Improvado, Adverity); SEO is solved (Ahrefs,
Semrush, SE Ranking). The hole is **plain-language translation for the owner /
marketing generalist**: *what's happening, why, how much money, what to do, what
to buy or delegate.* Evidence: McKinsey/BI on siloed tools, complexity, weak
skills, vanity-metric focus; WhatConverts — **95% of SMBs think they measure ad
ROI, only 25% do consistently.**

**ICP:** SMB / mid-market owners & marketing generalists + **agencies** (multi-
client resellers). Agencies imply multi-client / light white-label early — an
architectural input to the tenant + connector model (tenant-of-tenants).

**Non-goals (explicit):** don't out-Ahrefs Ahrefs, don't out-Funnel Funnel. Data
breadth and SEO depth are table-stakes *inputs*; the product **is the translation**.

**Caveat that gates the bet:** a translator is only as good as the ROI beneath
it. A confident explanation of a *wrong* attributed number is worse than silence
— so attribution correctness + honest model assumptions are what make the moat
possible, not nice-to-haves.

## Target architecture (layers)

| Layer | Responsibility | Status |
|---|---|---|
| L1 Sources | OAuth inbound connectors per source × tenant, scheduled sync | 🔴 main gap |
| L2 Identity & unify | person plane (have it) + channel plane via UTM+time+conversion | 🟡 |
| L3 Metric layer | spend / sessions / leads / revenue / CAC / ROAS by channel·campaign·time | 🔴 |
| L4 Attribution & ROI | join spend ⨝ revenue via an attribution model | 🔴 |
| L5 AI advisor | grounded narrative + recommendations, every claim cites a number | 🔴 the magic |
| L6 Console | ROI cockpit, insights feed, 3D customer view | 🟢 cockpit shipped |

## Four hard truths (design around them or the product breaks)

1. **The work is the connectors, not "collecting."** OAuth apps, per-platform app
   review (Meta/Google), rate limits, schema drift. ~70% of the eng effort.
2. **"Which channel is unprofitable & why" = JOIN spend (ad cabinets) with revenue
   (Stripe/CRM) through attribution.** Attribution is methodologically contested
   (last-click lies). Product credibility lives or dies on getting this join
   right and **showing the model's assumptions**, not stating a number as truth.
3. **SimilarWeb is *estimates*, not facts.** Modeled traffic. Useful for
   competitive context, dangerous if shown as ground truth.
4. **AI advice must be grounded and auditable** or it's slop that kills trust.
   Pattern: deterministic metric compute → LLM gets the computed table as context
   → explains/recommends *citing the figures*. Never "the LLM decided."

## Competitive reality
Crowded space: Improvado / Funnel.io (aggregation), Triple Whale / Northbeam
(attribution+advice for e-com), HubSpot. The differentiator is **not another
dashboard** — it's *unified data + AI explanation for a non-analyst + US-compliance
posture*. A generic aggregator loses; an "AI marketer that explains where money
leaks" can win.

## Wedge v1 — Channel ROI Advisor

Full cycle (source → unify → attribution → advice) on the smallest source set
that sells itself.

### v1 scope (recommended)
- **Connectors: Stripe + GA4 + Google Ads** (+ existing first-party).
  - One Google OAuth ecosystem covers GA4 + Google Ads → minimal app-review
    surface for v1. Stripe gives the revenue truth. **Defer Meta / LinkedIn /
    SimilarWeb / CRM to v2.**
- **Metric store: Postgres** (one tenant's daily campaign metrics is small).
  ClickHouse only when event-level attribution at scale forces it — see
  [the ClickHouse note](#clickhouse). Don't add it for v1.
- **Attribution: last-non-direct click** (GA4 default) — simple, explainable,
  labelled in the UI as a model. Multi-touch / data-driven in v2.
- **AI advisor**: deterministic ROAS/CAC table → LLM narrates per-channel verdict
  + one action, each citing the numbers. Grounded, auditable.
- **UI**: extend the console — a Channel ROI page + an insights feed of advice
  cards. Builds on the cockpit already shipped.

### Milestones
- **M0** — metric data model + connector framework (OAuth cred store per tenant, sync scheduler).
- **M1** — Stripe connector → revenue by day/customer.
- **M2** — GA4 connector → sessions/conversions by channel.
- **M3** — Google Ads connector → spend by campaign.
- **M4** — attribution + ROI compute → ROAS/CAC by channel.
- **M5** — AI advisor (grounded narrative) over the ROI table.
- **M6** — Channel ROI UI + insights feed.

### Open decisions (need a call)
- **Connectors: build-vs-buy.** Native (full control, months) vs embedded ETL
  (Airbyte/Singer-style) or a metrics API (Supermetrics) to pull ad data fast.
  This is the biggest cost driver. *Recommendation: native for first-party +
  Stripe + GA4 + Google Ads (manageable, owns the core); revisit buy when adding
  the long tail (Meta/LinkedIn/TikTok/…).*
- **Attribution model for v1:** last-non-direct (recommended) vs multi-touch now.
- **AI provider for the advisor:** must be grounded; pick model + guardrails.

## Module — SEO intelligence (wedge candidate / v2)

The user enters semantic/keyword queries; the system tracks **visibility &
position dynamics by month and year**, and **competitors' dynamics** on the same
queries. Positioned for our ICP (a non-SEO owner): *not "another Ahrefs"* —
explain what the numbers mean and fold them into the same ROI picture
("organic is X% of leads at $0 spend; here's the SEO gap and what to do").

- **Data:** SERP positions / search volume / competitor visibility via a SEO
  data API (DataForSEO / Ahrefs / SEMrush API) or an own SERP collector — pick on
  cost/limits (see research prompt §E).
- **Store:** time-series of rank/visibility per query × competitor × month.
- **Explain layer:** the differentiator — teach + advise, drive the upsell to a
  managed SEO package.

This is the clearest second wedge after Channel ROI: it embodies pillar 3
(explain → upsell) directly. Full research brief:
[docs/prompts/MARKET_RESEARCH_PROMPT.md](prompts/MARKET_RESEARCH_PROMPT.md).

### <a name="clickhouse"></a>ClickHouse — when, not whether
The earlier "why no ClickHouse in US?" connects here. v1 metric volume is small →
Postgres. ClickHouse earns its place once we store **event-level** marketing data
across many tenants for data-driven attribution and fast slice-and-dice — that's
its sweet spot, and the right time to add it to the US contour.
