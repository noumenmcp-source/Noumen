# AXIOM Revenue OS — Competitive Pricing Market Research & Pricing Strategy Report

**Prepared:** 2026-07-02 · **Scope:** en.axiom.rent (US market) · **Method:** Live site inspection (WebFetch) + official vendor pricing pages (WebFetch/WebSearch) across 10 SaaS categories, 63 vendors. Every price below is tagged **[Official]** (read directly from the vendor's own pricing page) or **[3rd-party: source]** (G2/Capterra/TrustRadius/Vendr/SaaSworthy/aggregator, used only where the vendor publishes no number). No price in this report is invented — where neither an official nor a credible third-party number exists, it says so explicitly.

---

## 1. Executive Summary

AXIOM is not an email tool, a scheduler, or a cookie-banner vendor competing on any single axis — it is a bundle of six categories (CDP, email/lifecycle automation, social listening, churn/revenue forecasting, booking/reminders, consent management) that the market sells almost entirely as **separate point products**, most of which go dark on price ("custom / quote-based") the moment a buyer looks serious enough to need real depth.

**The single most important finding across all 10 categories:** the market has already decided which capabilities are cheap commodities and which are worth real money, and it draws that line in a strikingly consistent place — **the "smart" layer of every category (identity stitching, churn prediction, audit-log/DSAR consent, real social listening, white-label reselling) is walled off behind either an enterprise quote or a 5-10x price jump from the entry tier, while the "dumb" layer (raw event pipes, basic email sends, a calendar, a cookie banner, post-scheduling) is a commoditized, often free, race to the bottom.** AXIOM's structural advantage is that it can bundle the *expensive* layer (identity-linked profiles, churn scoring, audit trails) into a price point that undercuts where competitors currently charge for it, because AXIOM already owns the unified customer data that makes those features cheap to deliver.

- **Cheap commodities AXIOM should never charge extra for:** booking/reminders ($0-60/mo everywhere), basic cookie-consent banners ($5-15/mo/domain, five vendors converge here), and generic email sending under ~10,000 contacts (Brevo/Omnisend push $9-60/mo).
- **Modules with real, defensible pricing power:** identity-resolved CDP (gated behind $40K-750K/yr enterprise deals at Segment/RudderStack/Bloomreach/mParticle/Treasure Data), churn/repeat-sale intelligence (never sold standalone — buried in $36K-180K+/yr HubSpot/Salesforce/Adobe suites), consent audit-log/DSAR (a distinct, expensive product line at OneTrust/Osano/Didomi, not a tier bump), and agency white-label access (a proven $497-499/month anchor at GoHighLevel and Vendasta).
- **Most dangerous competitors, by category:** Klaviyo (email, ecommerce lock-in via Shopify depth), GoHighLevel (agency/white-label, huge community moat), OneTrust (enterprise consent, owns the expensive end of the category), Brandwatch/Meltwater (social listening, data-licensing moat AXIOM cannot replicate quickly).
- **Recommended AXIOM pricing range:** **$79/month (Starter)** to **$599+/month (Business)**, **$449/month (Agency white-label)**, and a published *starting* enterprise number rather than a black-box quote — deliberately transparent through the tier that matters, unlike nine of the ten categories researched.
- **Best one-liner:** *"Instead of paying separately for Klaviyo, Calendly, Cookiebot, a Podium-lite reviews tool, and a Segment-lite CDP — plus a six-figure enterprise contract the moment you need churn prediction or a real consent audit trail — AXIOM gives SMBs and agencies one Revenue OS with all of that built in, priced like the point tools, not the enterprise suites."*

---

## 2. What AXIOM Is

Read directly from the live site (en.axiom.rent and its subpages) rather than assumed:

AXIOM ("Revenue OS") is built around a single **CDP** that unifies site, POS, ads, email, chat, and social data into one customer profile ("anonymous visits become people, people become segments"). Five connected products run on top of that same profile:

| Product | What it does | Live status on site |
|---|---|---|
| **Quill** | AI-driven email marketing/lifecycle automation — AI-suggested segments/copy, drag-and-drop builder, trigger flows | **Live** |
| **Social Recon** | Social listening across Instagram/TikTok/Reddit/YouTube — sentiment, trend detection, campaign hypotheses | **Live** |
| **Forecasts** | Churn-risk and seasonality prediction, prioritized action queue | Marked "Soon" |
| **Bookings** | Appointment reminders/confirmations, no-show reduction, review requests, seasonal scheduling | Marked "Soon" |
| **Consent** | CCPA/CPRA consent banner + signed audit log + DSAR handling | Marked "Pre-launch" on the main nav, but **actually live** with its own published pricing page |

The site's core pitch, in its own words: businesses "don't own the relationship" when a marketplace or a pile of disconnected tools sits between them and their customer, can't see who's about to churn, and are stuck stitching together five point solutions that don't talk to each other. AXIOM's answer is one owned, exportable customer base plus the apps built directly on it.

**AXIOM already has two pricing surfaces live**, which matters for this report:
1. **Homepage bundle pricing** — three tiers (Start / Growth / Agencies) are named and scoped by feature, but **all three show "Custom" with no dollar figures published** on the homepage or any product subpage.
2. **Consent's own pricing page** (en.axiom.rent/consent) **already publishes real numbers**: Free scan $0 → One site $9/mo → Business $29/mo → Agency $79-399/mo → Agency+ $899/mo → Enterprise custom, plus stated agency wholesale economics ("$3-7/site wholesale, $19-49/site resold, $1-3K/mo margin from 50 sites").

This means AXIOM is not starting from zero on pricing — Consent's ladder is a live, working proof that the "audit-log/DSAR is worth more than a banner" thesis (confirmed independently in Section 4.8) already informs AXIOM's own product thinking. The rest of this report extends that logic to the other five layers.

---

## 3. Service-Layer Map

| AXIOM Layer | Customer pain point (per the site) | Closest competitor category | Closest competitors | Sold standalone or suite? |
|---|---|---|---|---|
| **CDP + identity stitching + segmentation** | "The same customer lives in ten places at once" — no single view, every tool guessing | Customer Data Platform | Segment, mParticle, Tealium, Amperity, RudderStack | Both — but identity resolution specifically is almost always suite/enterprise-gated |
| **Quill (email/lifecycle)** | "Same to everyone" blasts burn the list; no personalization | Email marketing / lifecycle automation (ESP) | Klaviyo, Mailchimp, Attentive, Iterable | Both — increasingly bundled with a light CDP to compete |
| **Social Recon** | Trends show in social before they show in sales; monthly reports are already stale | Social listening | Brandwatch, Meltwater, Talkwalker, Mention, Brand24 | Traditionally standalone; AXIOM breaks norm by wiring it into segments/email |
| **Forecasts** | Reactive win-back with no visibility into who's about to churn | Predictive customer intelligence (churn/CLV) | Custora-style tools, CDP-embedded prediction modules | Add-on/suite — needs a CDP's transaction history underneath it |
| **Bookings** | No-shows, missed confirmations, off-season revenue dips | Appointment/booking + reminder software | Calendly, Acuity, Square Appointments, Podium (reminders) | Normally standalone, vertical-specific (salons, clinics) |
| **Consent** | Trackers fire before consent; no audit evidence if regulators investigate | Consent Management Platform (CMP) | OneTrust, Osano, Termly, Usercentrics, Cookiebot | Almost always standalone — compliance teams buy it independent of the marketing stack |

---

## 4. Pricing Benchmark by Category

*(Full competitor tables for every vendor are in Section 5; this section answers the specific questions from the research brief per category, using only the sourced numbers from Section 5.)*

### 4.1 CDP / Unified Customer Database

- **Lightweight/entry CDP:** $0-265/month — but this tier is a raw event pipe, **not** identity resolution. RudderStack Free ($0, 250K events) and Growth ($265/mo, 1M events) [Official], Segment Team ($120/mo, 10K MTUs) [Official], Customer.io Essentials ($100/mo, bundles "basic" Data Pipelines free) [Official].
- **Serious mid-market CDP:** No vendor in this set publishes a clean number here — this is the single biggest gap in the entire market. The closest disclosed figure is Ortto's third-party-estimated Professional/Business tier (**$509-999/mo** [3rd-party: encharge.io/SaaSworthy]), but Ortto is marketing automation with a CDP layer, not a dedicated identity-resolution platform.
- **Enterprise-only:** Bloomreach ($40K-250K+/yr [3rd-party: costbench.com]), mParticle (~$156K/yr average, up to $375K/yr [3rd-party: Vendr]), Treasure Data ($100K-750K/yr + $30-100K implementation [3rd-party: costbench.com]), Insider (~$950-1,300/mo starting, $50K+/yr typical [3rd-party: Spendbase.co]) — all 100% quote-based on their own official pages.
- **Is identity stitching included or gated?** **Gated, consistently and explicitly.** Segment's own pricing page marks identity resolution "Available with CDP Plans" — a separate product from its Connections pipeline. RudderStack shows identity resolution only under its Enterprise tier. Hightouch gates it to the paid, usage-metered "Composable CDP" module. This is the clearest, most consistent finding in the whole report: **identity stitching is the paywall that separates "pipe" from "CDP" everywhere.**
- **What AXIOM can charge:** A believable **$99-149/month** entry tier *with identity stitching included* undercuts nobody on the pipe-only tier ($120-265/mo) while offering something none of them do at that price. A **$299-499/month** "serious SMB" tier undercuts Ortto's third-party-estimated $509-999/mo band.

### 4.2 Email Marketing / Lifecycle Automation

- **Basic/entry email:** Free tiers are near-universal (Klaviyo, Brevo, Mailchimp, Omnisend all offer ~250-500 contacts free). Cheapest real paid entry: Brevo Starter **$9/mo** [Official] (5,000 emails, unlimited contacts, since Brevo prices by send volume not list size).
- **Advanced automation:** Gated everywhere. ActiveCampaign Starter explicitly caps automations at 5 actions/no branching; real automation needs Plus/Pro (**$49-99/mo** at 1,000 contacts) [3rd-party corroborated, official page JS-blocked]. HubSpot's advanced automation requires Professional at **$800/mo + $3,000 onboarding** [Official] — an order of magnitude above SMB tools, because it bundles ads/CMS/CRM, not just email.
- **Price scaling with list size (Klaviyo, cross-verified):**

  | Contacts | Monthly price |
  |---|---|
  | 500 | ~$20 |
  | 5,000 | ~$100 |
  | 25,000 | ~$400 |
  | 50,000 | ~$720 |
  | 100,000 | ~$1,200+ (not publicly listed past ~50K) |

  [3rd-party, cross-checked across multiple 2026 aggregators + a Klaviyo Community forum post; Klaviyo's own pricing page is a JS calculator with no static table]

- **When does per-contact pricing become expensive?** Inflection point is roughly **10,000-25,000 contacts** — past 25K, Klaviyo's curve (~$400/mo and climbing non-linearly) starts to rival a growth-stage SMB's entire marketing stack.
- **Real SMB benchmark:** **$100-400/month** on a per-contact platform (Klaviyo, 5K-25K contacts), or **$50-130/month** on a send-volume platform (Brevo Standard/Business) for comparable automation depth.
- **What AXIOM can charge:** Positioning against the documented Klaviyo curve, AXIOM can credibly message "no per-contact tax past 10K contacts" using flat or send-volume pricing instead of steep per-contact scaling — a direct, quantifiable wedge against the $100→$400→$1,200+ curve above.

### 4.3 AI-Personalized Campaigns (cross-cutting)

- **Do vendors charge separately for AI?** Yes, in every case researched, via one of three mechanisms — never as a fully separate flat product:
  1. **Explicit metered add-on:** Customer.io's own pricing page states outright: *"Additional AI credits: $10 / 100K"* [Official] — the cleanest, most explicit AI price point found in the entire report.
  2. **Named paid SKU, quote-priced:** Attentive names three paid AI products (AI Pro, AI Grow, AI Journeys) beyond its free "AI Essentials," with no public dollar figure [Official page confirms names, no price].
  3. **Bundled into a shared usage-credit pool, tier-gated for the advanced layer:** Klaviyo's Composer (AI copy) ships 10,000 free credits on the Free tier but is a distinct paid SKU beyond that; HubSpot's "Breeze AI" agents require Professional tier+; Braze's Sage AI draws from the same "Flexible Credits" pool as message sends but Predictive AI/Agent Console are Pro/Enterprise-gated.
- **Pattern:** basic AI (copy suggestions, simple segment builder) ships free or with a generous bundled allowance; advanced/predictive/agentic AI is tier-gated or metered incrementally.
- **What AXIOM can charge:** Bundle basic AI copy/segmentation free (matches category norm — nobody expects to pay extra for a subject-line suggestion), meter overage explicitly and cheaply (**$8-12 per 100K credits**, mirroring Customer.io's $10/100K precedent), and reserve a **$99-299/month** flat add-on or higher-tier gate for autonomous/predictive AI (matching Attentive's flat-fee AI Pro model and HubSpot's Professional-tier gating).

### 4.4 SMS / WhatsApp / Push / Multichannel Messaging

- **Twilio (raw wholesale layer):** SMS $0.0083/message [Official], WhatsApp $0.005/message platform fee + Meta template fee [Official]. Every ESP in this set is built on top of a rate like this.
- **Retail markup:** Klaviyo ~$0.009-0.012/credit [3rd-party: FirstPier], Omnisend $0.007-0.009/SMS (official, volume-tiered) [Official], Brevo ~$0.0109/SMS US [3rd-party: EmailToolTester, citing Brevo's own calculator] — all sitting at roughly a 30-45% markup over Twilio's raw US rate at low volume, compressing toward near-cost at high volume.
- **Recommendation: pass through, don't bundle a big free allotment.** SMS/WhatsApp cost is extremely country-variable (Brevo's own numbers show >3x spread US vs. UK; Klaviyo >10x spread US vs. Germany/Netherlands) — a flat "included" allotment either overprices US-heavy customers or exposes AXIOM to unpredictable margin risk. Even bundling-style competitors (Customer.io) cap the bundle and fall back to metered overage immediately. A small onboarding "starter credit" (mirroring Klaviyo's 150 free credits/month) removes friction without the structural risk of a real allowance.

### 4.5 Booking / Appointments / Reminders

- **Simple single-user scheduling:** **$0-16/month.** Calendly free forever (1 user), Setmore free (4 users, 200 appts/mo), Square free (solo), SimplyBook.me free (50 bookings/mo). Acuity's $16/mo Starter is the priciest true entry point in the set [all Official].
- **Multi-staff/multi-location:** The "team unlock" clusters at **$27-60/month**, with a second jump to **$60-150/month** for large teams/locations. Square's location-based model is the clearest: Plus $49/mo/location unlocks multi-staff; Premium $149/mo/location gives unlimited staff at that location [Official].
- **Is standalone booking a cheap commodity?** **Yes, overwhelmingly.** No vendor charges real money for scheduling as a bolted-on core function — the ceiling for a real (non-enterprise) small business tops out around $50-150/month. Real money in this category comes from adjacent monetization: Square's card-processing take-rate (2.4-3.3%), Calendly's CRM/sales-routing logic ($16-20/seat, then $15K/yr Enterprise for SSO/audit logs), Acuity's HIPAA compliance tier.
- **How AXIOM should position Bookings:** As a **free, near-zero-marginal-cost bundled feature**, not a standalone line item — fighting the entire market's pricing gravity by trying to charge for the scheduling mechanic itself would be a losing move. The wedge is that AXIOM already owns the customer profile/automation engine that Calendly charges Teams-tier money to bolt on (routing, CRM triggers) — booking becomes a natural, low-cost extension of infrastructure AXIOM already has, not a competing product.

### 4.6 Reviews / Reputation Management / Local Business Messaging

- **Basic review-generation:** **$75-99/month** — NiceJob $75/mo flat [Official] is the cheapest fully transparent price in the set; Grade.us $99/mo (1 location) [Official].
- **Full reputation management (per-location, published):** Reputation.com is the notable exception to this category's opacity — it publishes real per-location tiers: Rep Core $80/location/mo → +Pulse $115/location/mo → +Surveys $150/location/mo [Official].
- **Why are Podium and Birdeye expensive?** **Confirmed directly, not just by reputation** — both vendors' own pricing pages and their own Capterra listings show zero dollar figures for any tier; both are lead-gen funnels ("Get a custom quote" / a phone-number-gated configurator). Third-party aggregators converge on Podium Core ~$399/mo, Pro ~$599/mo and Birdeye Starter ~$299/mo/location, Growth ~$349/mo/location [3rd-party: RepliFast/WiserReview/CostBench], but both reportedly stack substantial hidden fees (10DLC fees, onboarding $500-15,000, an 8% "Innovation Fee" at renewal for Birdeye) that push real spend well past the headline third-party estimate.
- **Can AXIOM offer "reviews-lite"?** Yes — a reviews-lite tier (automated post-purchase/post-appointment review requests via the same event/automation infrastructure AXIOM already has, plus a simple aggregated inbox) is directly comparable in scope to what NiceJob charges $75/mo and Grade.us charges $99/mo for, and is a near-zero marginal feature to bundle rather than sell standalone.

### 4.7 Social Listening / Social Recon / Social Management

- **Basic social management (scheduling/publishing):** **$0-400/month** — Buffer ($0-10/channel) [Official], Later ($18.75-82.50/social set) [Official], Hootsuite Standard ($99/mo/user) [Official], Sprout Social Essentials ($79/seat/mo) [Official]. This answers "what do I post," not "what is the whole internet saying" — structurally different from listening.
- **Real listening, lighter lane:** Brand24 **$199-699/month** across 4 self-serve tiers, plus $1,499+/mo Enterprise [Official] — the clearest, cheapest, fully self-serve "real listening" product in the market. Mention repositioned to a single **$599/month** Company plan in mid-2025, no longer offering cheap self-serve tiers [Official].
- **Why are Brandwatch/Meltwater/Talkwalker expensive?** **Confirmed — all three publish zero dollar figures on their own official pages**, each explicitly stating pricing is "customized"/"tailored" to data volume and program scale. Third-party deal data (Vendr) puts Meltwater's median buyer around $25,000/year, with Brandwatch's third-party-estimated self-serve-adjacent floor around $800/month and enterprise configurations reaching $150,000+/year. This is a **data-licensing moat, not a software moat** — these vendors' real product is negotiated firehose access to X/Reddit/TikTok/news archives that took over a decade to assemble.
- **Should AXIOM compete with enterprise listening, or take the lighter lane?** **The lighter lane (Brand24/Mention-tier) is the only credible one.** AXIOM has no data-licensing contracts and shouldn't try to build them overnight; the buyer/sales motion for Brandwatch/Meltwater (RFPs, named reps, $25K-150K/yr deals) is a different business from AXIOM's SMB-direct + agency-white-label GTM. AXIOM's real differentiator in this lane is cross-referencing social signals against first-party CDP data — something standalone listening tools structurally cannot do.

### 4.8 Consent Management / Cookie / Privacy Compliance

- **Basic cookie-banner CMP, per domain:** **$5-15/month** — five vendors converge tightly here: Cookiebot €7/mo [Official], Usercentrics €7/mo [Official], CookieYes $10/mo [Official], Termly $10-14/mo [Official], iubenda €4.99/mo [Official]. This is a fully commoditized price point.
- **Enterprise privacy management (OneTrust tier):** **Confirmed 100% quote-based** — OneTrust's official pricing page states every solution package (CMP, Universal Consent, Privacy Automation) is priced on a usage meter disclosed only via "Get Customized Pricing" [Official page confirms no public numbers]. Third-party deal data (cited via Vendr, corroborated by a Forrester case study citing $292K/year for a large enterprise) suggests real spend clusters from ~$10K/year (small business) to $120K-500K+/year (enterprise) [3rd-party].
- **Banner vs. audit-log/DSAR — does the price ladder reflect the functional gap?** **Only partially, and mostly as a jump to a separate product line, not a smooth tier.** Termly is the cleanest same-vendor example (consent logs unlock at Pro+, $15-20/mo — a modest 2x step, still just a log, not real DSAR). Cookiebot has **no** audit/DSAR tier at any price point. Osano is the most explicit: Subject Rights Management (DSAR)/Vendor Management/Assessments only appear in its custom-quoted Premier tier, with sales messaging explicitly separating "consent management" from "DSAR" as different problems. **The pattern: audit-log/DSAR is not an incremental tier — it's a different, usually quote-based product family.**
- **How should AXIOM price Consent?** **Not as a cheap-per-domain add-on.** The banner-only capability is a fully commoditized, near-zero-margin segment already occupied by five vendors — AXIOM shouldn't try to win that fight on price. The audit-log/DSAR capability is the only lever every competitor treats as premium-worthy, and AXIOM's structural advantage is that consent events, DSAR requests, and audit logs already live in the *same* customer-profile data model as the rest of the CDP — no separate integration, no separate vendor reconciliation. That is exactly the "Premium/Corporate/Enterprise" value proposition OneTrust/Didomi/Usercentrics sell standalone and expensively. **AXIOM's live Consent pricing (Section 2) already reflects this instinct** (Free scan → $9 → $29 → $79-399 → $899 → Custom) and this research validates that ladder rather than suggesting a change.

### 4.9 White-Label / Agency OS

- **Straightforward agency platform, entry tier:** **$20-100/month** — but almost never includes white-label at this price. Systeme.io Unlimited $97/mo [Official], GoHighLevel Starter $97/mo (capped at 3 sub-accounts) [Official], Vendasta Starter $99/mo (explicitly "co-branded," not white-label) [Official].
- **White-label SaaS mode specifically:** **Gated behind a 5x premium at the two dominant vendors.** GoHighLevel's white-label "SaaS Mode" (resell under your own brand, bill via Stripe) is exclusive to **Agency Pro at $497/month** [Official] — a 5x jump over its $97 Starter. Vendasta's white-label client portal unlocks only at **Professional, $499/month minimum** [Official], plus a mandatory $500-1,500 onboarding fee. DashClicks is the outlier, bundling white-label into a single flat **$199/month** [Official] — no upsell tier at all.
- **What agencies actually pay:** Convergence around **$450-500/month** for "real" white-label mode among the two dominant, currently-live vendors (GoHighLevel $497, Vendasta $499), with a $199 low-cost outlier (DashClicks) and a cautionary historical data point (SharpSpring, $449-1,449/mo, **discontinued in 2026** [3rd-party: TrustRadius] — proof that mid-high pricing without a clear moat doesn't guarantee survival in this category).
- **Should AXIOM price against GoHighLevel directly?** **Recommendation: price in the $299-449/month band** — below the $497-499 GoHighLevel/Vendasta anchor (a credible switch-target discount, similar to DashClicks' strategy but not as low as DashClicks' $199, since AXIOM's broader scope — CDP + consent + email + social intel + forecasts — is a wider bundle than any single vendor here offers).

### 4.10 Revenue Analytics / Attribution / Churn / Repeat-Sales Intelligence

- **Ecommerce attribution, entry level:** All four vendors researched price on a **business-size proxy metric** (GMV, tracked revenue, media spend), never flat seats: Triple Whale $219/mo (Foundation, free tier also exists) [Official], Wicked Reports $499/mo (Measure) [Official], Hyros $230/mo (Business track) [Official], Northbeam $1,500/mo (Starter, for brands under $1.5M media spend) [Official]. **Pattern:** entry price is real and public, but the scaling curve goes opaque past the first 1-2 tiers for three of four vendors.
- **General product analytics:** Different pricing DNA — Mixpanel and Amplitude price on **event/MTU volume**, not revenue, both free to a real usage ceiling (Mixpanel: 1M events/mo free, then $0.28/1K events; Amplitude: 10K MTUs + 2M events free) [both Official].
- **Is churn prediction ever sold standalone?** **No — this is the clearest white-space finding in the entire report.** None of the nine vendors researched (Triple Whale, Northbeam, Wicked Reports, Hyros, Mixpanel, Amplitude, HubSpot, Salesforce MCI, Adobe CJA) sell "churn score" or "repeat-purchase priority" as a named, separately-priced SKU. It's either a thin bolt-on (Triple Whale's Retention add-on, +$19/mo) or buried inside enterprise suites (HubSpot Professional $800/mo+, Salesforce MCI ~$36K-180K/yr [3rd-party: PricingNow], Adobe CJA — **no usable number found anywhere, official or third-party**, reported plainly rather than invented).
- **What AXIOM can package:** Given that no vendor sells "forecast + churn risk + repeat-sale priority" as an affordable standalone SMB product, this is AXIOM's clearest white space. Price on a revenue-indexed metric (matching the ecommerce-attribution convention SMB/DTC buyers already understand), publish a transparent ladder through at least tier 2-3 (unlike Northbeam/Hyros/Wicked Reports, which go opaque early), and bundle churn-risk/repeat-purchase scoring into the entry/mid tier rather than as a cheap bolt-on or an enterprise-suite line item — anchoring below the $499-999/mo band (Wicked Reports Measure-Maximize) that has already proven willingness-to-pay for revenue-intelligence tools.

---

## 5. Competitor Pricing Tables

*(Vendor, Official starting price, Pricing metric, Limits, Mid-market/advanced price, Enterprise model, Source, Notes. `[3rd]` marks a third-party-sourced figure.)*

### 5.1 CDP / Customer Data Platform

| Vendor | Starting price | Metric | Limits | Mid-market | Enterprise | Source |
|---|---|---|---|---|---|---|
| Twilio Segment | Free (1K MTU); $120/mo (10K MTU) | MTUs, tiered overage | 2 sources, 1 warehouse dest. (free) | Business: custom (adds identity resolution) | Custom quote | [segment pricing](https://www.twilio.com/en-us/products/connections/pricing) |
| Ortto | Custom (no public #) | per contact tier | ~5K contacts entry `[3rd]` | ~$509-999/mo `[3rd: encharge.io/SaaSworthy]` | Custom | [ortto.com/pricing](https://ortto.com/pricing/) |
| Bloomreach Engagement | Custom (no public #) | module + usage fee | n/a | $40K-250K+/yr `[3rd: costbench.com]` | Custom, 6-figure | [bloomreach.com/pricing](https://www.bloomreach.com/en/pricing) |
| Insider (Insider One) | Custom (no public #) | platform fee + usage | n/a | ~$950-1,300/mo `[3rd: Spendbase.co]` | Custom, $50K+/yr typical | [useinsider.com/pricing](https://useinsider.com/pricing/) |
| mParticle | Custom (no public #) | "mParticle Credits" | n/a | ~$156K/yr avg `[3rd: Vendr]` | up to ~$375K/yr `[3rd]` | [mparticle.com/pricing](https://www.mparticle.com/pricing/) |
| Treasure Data | Custom (no public #) | stored profiles/events | n/a | $100K-750K/yr `[3rd: costbench.com]` | Custom + $30-100K implementation | [treasuredata.com/pricing](https://www.treasuredata.com/product/pricing/) |
| RudderStack | Free (250K events); $265/mo (1M events) | monthly event volume | Identity resolution = Enterprise only | Scales to 25M+ events/mo | Custom | [rudderstack.com/pricing](https://www.rudderstack.com/pricing/) |
| Hightouch | Free (2 syncs/mo) | active syncs | No public paid tier price currently | ~$1,000/mo `[3rd, possibly stale]` | ~$15K/yr median `[3rd: costbench.com]` | [hightouch.com/pricing](https://hightouch.com/pricing) |
| Customer.io Data Pipelines | Bundled in Journeys, $100/mo | profiles + emails | 5K profiles, 1M emails (Essentials) | $1,000/mo (Premium, adds warehouse dest.) | Custom | [customer.io/pricing](https://customer.io/pricing) |

### 5.2 Email Marketing / Lifecycle Automation

| Vendor | Starting price | Metric | Limits | Mid-market | Enterprise | Source |
|---|---|---|---|---|---|---|
| Klaviyo | Free (250 profiles); ~$20/mo (500) | active profiles | SMS billed separately | ~$400/mo @ 25K contacts `[3rd, cross-verified]` | Not published | [klaviyo.com/pricing](https://www.klaviyo.com/pricing) |
| Brevo | $9/mo (5K emails) | email volume, unlimited contacts | Logo removal +$9/mo | $18-129/mo (5K-100K emails) | ~$499/mo+ `[3rd]` | [brevo.com/pricing](https://www.brevo.com/pricing/) |
| Mailchimp | Free (500 contacts) | contact-count tier | Sends capped at multiple of contacts | ~€17.66/mo+ (Standard) | Custom above 200K contacts | [mailchimp.com/pricing](https://mailchimp.com/pricing/) |
| Omnisend | Free (250 contacts); $11.20/mo (500) | contact-count tier | — | $41.30/mo (Pro, 2,500 contacts) | Custom above ~150K contacts | [omnisend.com/pricing](https://www.omnisend.com/pricing/) |
| ActiveCampaign | $15-19/mo (1K contacts) | contact-count tier | Starter: 5 actions/workflow, no branching | Plus $49-59, Pro $79-99 (1K contacts) `[3rd, official JS-blocked]` | $145-179/mo (Enterprise tier) | [activecampaign.com/pricing](https://www.activecampaign.com/pricing) |
| Customer.io | $100/mo (5K profiles) | profile count + email overage | 1M emails/mo included | $1,000/mo (Premium, 10K profiles) | Custom | [customer.io/pricing](https://customer.io/pricing) |
| HubSpot Marketing Hub | Free; $7-20/seat/mo (Starter) | seat + contact tier | 1,000 marketing contacts | $800/mo (Professional, +$3,000 onboarding) | $3,600/mo (+$7,000 onboarding) | [hubspot.com/pricing/marketing](https://www.hubspot.com/pricing/marketing) |
| Iterable | Custom (no public #) | MAU + contract term | n/a | Not published | Median $88,880/yr `[3rd: Vendr]` | [vendr.com/marketplace/iterable](https://www.vendr.com/marketplace/iterable) |
| Braze | Custom (no public #) | MAU + Action Credits | n/a | Not published | Median $91,251/yr-range `[3rd: Vendr]` | [vendr.com/marketplace/braze](https://www.vendr.com/marketplace/braze) |

### 5.3 SMS / WhatsApp / Multichannel Messaging

| Vendor | Starting price | Metric | Notes | Source |
|---|---|---|---|---|
| Twilio | $0.0083/SMS (US) | usage, pure pass-through | WhatsApp: $0.005/msg + Meta template fee | [twilio.com/sms/pricing](https://www.twilio.com/en-us/sms/pricing/us) |
| Brevo | ~$0.0109/SMS (US) `[3rd: EmailToolTester]` | prepaid credit packs | Country-variable (UK ~$0.0345/msg) | [brevo.com/pricing](https://www.brevo.com/pricing/) |
| Klaviyo | $15/mo (1,250 credits) | credit-pack subscription | 150 free credits/mo on paid plans | [klaviyo.com/pricing](https://www.klaviyo.com/pricing) |
| Omnisend | $0.007-0.009/SMS (US) | volume-tiered usage add-on | Official, tiered by monthly spend | [omnisend.com/pricing](https://www.omnisend.com/pricing/) |
| Customer.io | $100/mo base + $0.012/segment overage | bundled allotment + overage | Included quota not itemized publicly | [customer.io/pricing](https://customer.io/pricing) |

### 5.4 Booking / Appointments / Reminders

| Vendor | Starting price | Metric | Team/location unlock | Enterprise | Source |
|---|---|---|---|---|---|
| Calendly | Free (1 user); $10-12/seat/mo | per seat | Teams $16-20/seat/mo | $15,000/yr (invoice, SSO/SAML/audit) | [calendly.com/pricing](https://calendly.com/pricing) |
| Appointy | Free (1 staff); $29.99/mo | per plan tier | Professional $59.99/mo (5 staff) | $99.99/mo (self-serve "Enterprise") `[3rd: Capterra]` | [capterra.com Appointy](https://www.capterra.com/p/122249/Appointy/pricing/) |
| Acuity Scheduling | $16/mo (1 calendar) | per team member | Standard $27/mo (6 calendars) | Custom (unlimited calendars) | [acuityscheduling.com](https://acuityscheduling.com/signup.php) |
| Square Appointments | Free (solo) | per location | Plus $49/mo/location (multi-staff) | Premium $149/mo/location (unlimited staff) | [capterra.com Square](https://www.capterra.com/p/170263/Square-Appointments/pricing/) |
| Setmore | Free (4 users) | per user | Pro $5-12/user/mo (unlimited users) | Custom (Team/Enterprise) | [setmore.com/pricing](https://www.setmore.com/pricing) |
| SimplyBook.me | Free (50 bookings/mo) | bookings + providers | Standard €24.90/mo (15 providers) | Custom, multi-location/franchise | [simplybook.me/pricing](https://simplybook.me/en/pricing) |

### 5.5 Reviews / Reputation Management

| Vendor | Starting price | Metric | Mid-market | Notes | Source |
|---|---|---|---|---|---|
| Podium | Custom (no public #) | per location + seats | ~$599/mo `[3rd: RepliFast]` | Own site: zero $ figures, lead-gen only | [podium.com/getpricing](https://www.podium.com/getpricing) |
| Birdeye | Custom (no public #) | per location | ~$349/mo/location `[3rd]` | +8% "Innovation Fee" at renewal `[3rd]` | [birdeye.com/pricing](https://birdeye.com/pricing/) |
| Reputation.com | $80/location/mo | per location | $115-150/location/mo | Rare official per-location #s in this category | [reputation.com/pricing](https://reputation.com/pricing) |
| Yext (Reviews) | $199/yr (Emerging) | per business/yr | $999/yr (Review Monitoring gated here) | Enterprise Reviews: $400-1,200/location/yr `[3rd: Vendr]` | [yext.com/pl/plans](https://www.yext.com/pl/plans.html) |
| NiceJob | $75/mo (Reviews) | flat monthly | $125/mo (Pro) | Cheapest fully transparent price in category | [get.nicejob.com/pricing](https://get.nicejob.com/pricing) |
| Trustpilot | $99/mo/domain (Starter) | per domain, annual | $319/mo (Plus), $799/mo (Premium) | 12-month prepaid commitment | [business.trustpilot.com/pricing](https://business.trustpilot.com/pricing) |
| Grade.us | $99/mo (1 location) | per location | $60/mo/location (2-10 locations) | Agency tier: custom quote | [grade.us/plans](https://www.grade.us/home/plans/) |

### 5.6 Social Listening / Social Management

| Vendor | Starting price | Metric | Real listening? | Enterprise | Source |
|---|---|---|---|---|---|
| Hootsuite | $99/mo/user | per user | Only at custom Enterprise | Custom (adds listening, SSO) | [hootsuite.com/plans](https://www.hootsuite.com/plans) |
| Sprout Social | $79/seat/mo | per seat | Listening = undisclosed paid add-on | Custom | [sproutsocial.com/pricing](https://sproutsocial.com/pricing/) |
| Brandwatch | Custom (no public #) | usage/data volume | Yes — this is the product | Custom, sales-only | [brandwatch.com/plans](https://www.brandwatch.com/plans/) |
| Meltwater | Custom (no public #) | usage/data volume | Yes — this is the product | ~$25K/yr median `[3rd: Vendr]` | [meltwater.com/pricing](https://www.meltwater.com/en/pricing) |
| Talkwalker | Custom (no public #) | not published | Yes — this is the product | Custom, sales-only | [talkwalker.com/pricing](https://www.talkwalker.com/pricing) |
| Mention | $599/mo (Company, only tier) | flat, mention-volume-capped | Yes | n/a — single plan only | [mention.com/pricing](https://mention.com/en/pricing/) |
| Brand24 | $199/mo (Individual) | keywords + mention volume | Yes — cheapest real self-serve listening | $1,499+/mo (Enterprise) | [brand24.com/pricing](https://brand24.com/pricing/) |
| Buffer | Free; $5/mo/channel | per channel | No — publishing only | No distinct enterprise tier | [buffer.com/pricing](https://buffer.com/pricing) |
| Later | $18.75/mo (Starter) | per "social set" | No — publishing only | No distinct enterprise tier | [later.com/pricing](https://later.com/pricing/) |

### 5.7 Consent Management / Cookie / Privacy

| Vendor | Starting price | Metric | Audit-log/DSAR? | Enterprise | Source |
|---|---|---|---|---|---|
| Cookiebot | Free; €7/mo (Premium Lite) | per domain, subpages | No, at any tier | n/a | [cookiebot.com/pricing](https://www.cookiebot.com/us/pricing/) |
| Usercentrics | Free; €7/mo (Essential) | per domain, sessions | Only in custom Corporate tier | Custom, from 1M sessions/mo | [usercentrics.com/pricing](https://usercentrics.com/pricing/) |
| OneTrust | Custom (no public #) | visitors/profiles/users | Yes — this is a core product line | Custom, ~$10K-500K+/yr `[3rd]` | [onetrust.com/pricing](https://www.onetrust.com/pricing/) |
| Didomi | Custom (no public #) | MUV / scans / API calls | Yes, Premium tier | Custom | [didomi.io/offers](https://www.didomi.io/offers) |
| Osano | $199/mo (Plus) | visitors + domains | No — DSAR only in custom Premier tier | Custom | [enzuzo.com/blog/osano-pricing](https://www.enzuzo.com/blog/osano-pricing) `[3rd]` |
| CookieYes | Free; $10/mo (Basic) | per domain, pageviews | No, at any tier | n/a | [cookieyes.com/pricing](https://www.cookieyes.com/pricing/) |
| Termly | Free; $10-14/mo (Starter) | per site, banner views | Yes, but only at Pro+ ($15-20/mo) — lightweight log only | Custom (Agency, 10+ sites) | [termly.io/pricing](https://termly.io/pricing/) |
| iubenda | Free; €4.99/mo (Essentials) | per site, pageviews | Consent recovery at Ultimate, still self-serve | n/a | [iubenda.com/pricing](https://www.iubenda.com/en/pricing/) |

### 5.8 White-Label / Agency OS

| Vendor | Starting price | White-label price | Metric | Source |
|---|---|---|---|---|
| GoHighLevel | $97/mo (Starter, 3 sub-accounts) | **$497/mo** (Agency Pro / SaaS Mode) | flat + sub-account tier | [gohighlevel.com/pricing](https://www.gohighlevel.com/pricing) |
| Vendasta | $99/mo min. (Starter, co-branded only) | **$499/mo** min. (Professional) | platform min. + seats + reports | [vendasta.com/pricing](https://www.vendasta.com/pricing/) |
| DashClicks | $199/mo (Pro, incl. white-label) | Included at base tier | flat, unlimited sub-accounts | [dashclicks.com/pricing](https://www.dashclicks.com/pricing) |
| AgencyAnalytics | $20/client/mo (incl. white-label) | Included at base tier | per client (reporting-only) | [agencyanalytics.com/pricing](https://agencyanalytics.com/pricing) |
| SharpSpring/Constant Contact | **Discontinued 2026** `[3rd: TrustRadius]` | ~$449-1,449/mo historical | contact-tier (historical) | [constantcontact.com](https://www.constantcontact.com/pricing/lead-gen-crm) |
| Systeme.io | Free; $17/mo (Startup) | Not published | contact-count tier | [systeme.io/pricing](https://systeme.io/pricing) |

### 5.9 Revenue Analytics / Attribution / Churn

| Vendor | Starting price | Metric | Mid-market | Enterprise | Source |
|---|---|---|---|---|---|
| Triple Whale | Free; $219/mo (Foundation) | trailing-12mo GMV band | $749/mo (Automate) | Custom (MMM, incrementality) | [triplewhale.com/pricing](https://www.triplewhale.com/pricing) |
| Northbeam | $1,500/mo (Starter, <$1.5M media spend) | pageviews + media-spend tier | Custom (>$250K/mo spend) | Custom (>$500K/mo spend) | [northbeam.io/pricing](https://www.northbeam.io/pricing) |
| Wicked Reports | $499/mo (Measure) | annual revenue band | $999/mo (Maximize) | $4,999+/mo | [wickedreports.com/pricing](https://wickedreports.com/pricing/) |
| Hyros | $230/mo (Business track) | tracked monthly revenue band | Not published past entry | Custom (Agency track) | [hyros.com/pricing](https://hyros.com/pricing-ai-tracking) |
| Mixpanel | Free (1M events/mo) | monthly events | $0.28/1K events overage | Custom | [mixpanel.com/pricing](https://mixpanel.com/pricing/) |
| Amplitude | Free (10K MTU, 2M events) | MTUs + events | Usage-based to ~70M events | Custom | [amplitude.com/pricing](https://amplitude.com/pricing) |
| HubSpot (analytics) | Free; $7/seat/mo | seat + contact tier | $800/mo (Professional) | $3,600/mo (+$7,000 onboarding) | [hubspot.com/pricing/marketing](https://www.hubspot.com/pricing/marketing) |
| Salesforce MCI | Custom (no public #) | data volume + connectors | ~$36K-120K/yr `[3rd: PricingNow]` | $80K-180K+/yr `[3rd]` | [pricingnow.com](https://pricingnow.com/question/datorama-pricing/) |
| Adobe CJA | Custom (no public #) | consumption-based | **No usable number found anywhere** | **No usable number found anywhere** | [business.adobe.com](https://business.adobe.com/products/adobe-analytics/customer-journey-analytics.html) |

---

## 6. Master Price Matrix

| Service layer | Closest competitors | Lowest public price | Normal SMB price | Mid-market price | Enterprise price | Pricing metric | Standalone? | AXIOM bundle? | AXIOM pricing power |
|---|---|---|---|---|---|---|---|---|---|
| CDP + identity stitching | Segment, RudderStack, Hightouch | $0 (RudderStack free) | $100-265/mo *(pipe only — no identity)* | $509-999/mo `[3rd: Ortto]` | $40K-750K/yr | MTUs/events/profiles | Both | **Yes — core, bundled, don't sell alone** | **HIGH** — identity is gated everywhere else |
| Email automation | Klaviyo, Brevo, ActiveCampaign | $0 free | $50-400/mo (5-25K contacts) | $800-1,000/mo | $50K-200K+/yr | per-contact or per-send | Both | Yes | MEDIUM — commoditized low end |
| AI personalization | Klaviyo AI, Customer.io AI, Attentive AI | Free (bundled allowance) | $8-12/100K credits overage | $99-299/mo flat add-on | Custom | credits or tier-gate | Add-on/bundled | Yes — bundle base, meter overage | MEDIUM-HIGH |
| SMS / WhatsApp | Twilio (wholesale) | $0.0083/msg | $0.009-0.012/SMS retail | n/a | n/a | per-message | Pass-through | Pass-through, thin markup | LOW — commodity |
| Booking / reminders | Calendly, Acuity, Square | $0 free | $10-60/mo | $150/mo/location | $15K/yr | per-seat/location | Standalone (commodity) | Yes — bundle free | **ZERO** — monetize adjacency, not the feature |
| Reviews / reputation | Podium, Birdeye, NiceJob | $75/mo (NiceJob) | $75-150/mo | $300-600/mo (opaque) | Custom, multi-location | per-location | Standalone | Yes — reviews-lite bundle | MEDIUM — real money only at enterprise scale |
| Social Recon | Brand24, Mention vs. Brandwatch/Meltwater | $199/mo (Brand24) | $199-599/mo | $10K-150K+/yr (enterprise-only) | Custom | keyword/mention volume | Standalone | Yes — lite bundle, not enterprise | MEDIUM — stay in the self-serve lane |
| Consent (banner) | Cookiebot, CookieYes, Termly | $0 free | $5-15/mo/domain | $50-90/mo/domain | $10K-500K+/yr | per-domain/session | Standalone | Yes | LOW at banner tier |
| Consent (audit/DSAR) | OneTrust, Osano Premier, Usercentrics Corporate | n/a (never cheap) | n/a | $10K+/yr territory | $10K-500K+/yr | quote/usage | Rarely bundled | **Yes — structural advantage** | **HIGH** — market already pays for this separately |
| Agency white-label | GoHighLevel, Vendasta, DashClicks | $199/mo (DashClicks) | $299-449/mo *(recommended AXIOM band)* | $497-499/mo (GHL/Vendasta anchor) | Custom | flat platform fee | Standalone tier | Yes — distinct plan | **HIGH** — proven $500/mo anchor |
| Revenue analytics / attribution | Triple Whale, Wicked Reports, Northbeam | $219/mo (Triple Whale) | $219-749/mo | $999-1,500/mo | $4,999+/mo; $36K-180K/yr (suite-bundled) | GMV/revenue band | Standalone | Yes | MEDIUM-HIGH — transparency is the wedge |
| Churn / lifecycle intelligence | *(none standalone)* | n/a | n/a | n/a | $36K-180K+/yr, buried in suites | n/a | **Never standalone anywhere researched** | **Yes — the white-space opportunity** | **HIGH** — no one sells this affordably alone |

---

## 7. Stack-Cost Simulations

Each scenario picks a representative, real, sourced tool per need (Section 5 has the full citation for every price used below) and totals what a business would actually pay assembling AXIOM's equivalent capability from best-of-breed point tools.

### Scenario A — Very Small SMB
*1 location, 2-5 staff, 2,000 contacts, basic email, simple booking, cookie consent, no social listening, no reputation management.*

| Need | Tool chosen | Monthly cost |
|---|---|---|
| Email | Brevo Starter (unlimited contacts, 5K emails/mo) | $9 |
| Booking | Setmore Free (4 users, 200 appts/mo) | $0 |
| Cookie consent | CookieYes Basic (100K pageviews) | $10 |
| **Total** | | **~$19/month (~$228/year)** |

*(If Klaviyo is used instead of Brevo for its ecommerce depth, 2,000 contacts runs closer to $50-60/mo, pushing the total to ~$60-70/month / ~$720-840/year — still a small bill, but AXIOM's Starter tier at $79/mo already includes a real CDP with identity stitching that neither Brevo nor Klaviyo's entry tier offers.)*

**What's missing vs. AXIOM:** no unified customer profile at all — Brevo/Setmore/CookieYes don't share data with each other; no churn/forecast signal; no social listening.

### Scenario B — Growing SMB
*1-3 locations, 10,000-25,000 contacts, email automation, booking/reminders, reviews, basic CDP, consent, light analytics.*

| Need | Tool chosen | Monthly cost |
|---|---|---|
| Email automation | Klaviyo (25K contacts) | $400 |
| Booking/reminders | Acuity Premium (up to 36 calendars, multi-location) | $49 |
| Reviews | Grade.us Multi-Location (~2 locations avg) | $120 |
| Basic CDP | Segment Team (10K MTUs, no identity resolution) | $120 |
| Consent | CookieYes Pro (300K pageviews) | $25 |
| Light analytics | Mixpanel Free (under 1M events) | $0 |
| **Total** | | **~$714/month (~$8,568/year)** |

**What's missing vs. AXIOM:** Segment Team explicitly excludes identity resolution — none of these six tools know they're looking at the same customer. No churn/forecast signal exists anywhere in this stack at any price under enterprise.

### Scenario C — Local Multi-Location Business
*5-20 locations, booking/reminders, reviews/reputation, messaging, customer database, attribution, consent.*

| Need | Tool chosen (10 locations, midpoint) | Monthly cost |
|---|---|---|
| Booking/reminders | Square Appointments Plus ($49/location × 10) | $490 |
| Reviews/reputation | Reputation.com Rep Core + Pulse ($115/location × 10) | $1,150 |
| Messaging (SMS) | Twilio, estimated moderate volume | ~$300 |
| Customer database | Ortto Business (mid-market CDP, `[3rd]` estimate) | ~$1,000 |
| Attribution | Triple Whale Foundation | $219 |
| Consent | CookieYes Pro (shared domain) | $25 |
| **Total** | | **~$3,184/month (~$38,208/year)** |

**What's missing vs. AXIOM:** this is the scenario where the "stack tax" is most visible — over $38K/year and still no genuine identity stitching across all six tools, no unified consent record tied to the same profile, and reputation management (Reputation.com) opaque-priced competitors (Podium/Birdeye) would push materially higher. This is the strongest case for AXIOM's Business tier.

### Scenario D — Marketing Agency
*10-50 client accounts, white-label portal, email automation, reporting, client subaccounts, templates, consent, lightweight CDP.*

| Need | Tool chosen (30 clients, midpoint) | Monthly cost |
|---|---|---|
| White-label platform (CRM/funnels/email/SMS) | GoHighLevel Agency Pro (SaaS Mode) | $497 |
| Client-facing reporting | AgencyAnalytics ($20/client × 30) | $600 |
| Per-client consent | Termly Pro+ ($15-20/client × 30) | $500 |
| Lightweight CDP per client | **No credible tool exists at this scale/price point** | — |
| **Total** | | **~$1,597/month (~$19,164/year)** |

**What's missing vs. AXIOM:** there is no lightweight, affordable per-client CDP layer in this stack at all — agencies either skip it entirely or would need to negotiate a custom Segment/mParticle contract per client, which is economically absurd at agency scale. This is a genuine gap AXIOM's Agency tier can fill that GoHighLevel/Vendasta structurally cannot (neither is a CDP).

---

## 8. Pricing Gaps and Opportunities

1. **The $500-$5,000/month CDP-with-identity-stitching tier barely exists.** Every vendor either sells a cheap pipe (no identity) or an opaque enterprise contract. AXIOM's Starter/Growth tiers can occupy this gap directly.
2. **Churn/repeat-sale intelligence has zero affordable standalone competitors.** This is the strongest, cleanest white-space finding in the whole report — no vendor across 9 analytics/CRM competitors sells it alone at any SMB-reachable price.
3. **Consent audit-log/DSAR is proven expensive everywhere it exists, but never unified with a CDP.** AXIOM can offer the OneTrust-tier capability (audit trail, DSAR workflow) natively tied to the same profile as marketing data — nobody else structurally can, because none of these vendors also sell a CDP.
4. **Agencies have a proven $497-499/month appetite for white-label, but zero affordable lightweight CDP option per client.** AXIOM's Agency tier can be the first to include both in one line item.
5. **Social listening's affordable lane (Brand24/Mention, $199-599/mo) has no CDP cross-reference anywhere.** AXIOM can differentiate Social Recon not on data breadth (a losing fight against Brandwatch/Meltwater) but on tying signals to actual customer records.

---

## 9. Recommended AXIOM Pricing Model

### 9.1 Pricing Ladder

**1. Starter SMB — $79/month**
- *Who:* single-location SMBs, 1-5 staff, under 5,000 contacts (Scenario A profile).
- *Includes:* CDP with identity stitching bundled (the core differentiator vs. Segment/RudderStack's paywalled version), Quill email up to 5,000 contacts, Consent banner-only tier (1 domain), Bookings (unbundled, free, unlimited).
- *Limits:* 5,000 contacts, 1 consent domain, no Social Recon/Forecasts/reviews.
- *Why this price:* Scenario A's assembled stack (email + booking + consent alone, no CDP at all) already runs $19-70/month. $79/month for the same three functions *plus* a real identity-stitched CDP undercuts the $100-265/month pipe-only tier (Segment, RudderStack) while adding something neither offers at any price below enterprise.

**2. Growth SMB — $249/month**
- *Who:* growing SMBs, 10,000-25,000 contacts, need social listening, forecasting, and reviews (Scenario B profile).
- *Includes:* everything in Starter + 25,000-contact ceiling, Social Recon (Brand24/Mention-lite equivalent), Forecasts/churn-risk, reviews-lite, metered SMS pass-through.
- *Why this price:* Scenario B's assembled stack totaled ~$714/month. $249/month undercuts that by two-thirds while including Forecasts/churn intelligence that literally no competitor offers below enterprise pricing ($36K+/year).

**3. Business — $599/month** *(scales with locations above a baseline)*
- *Who:* multi-location businesses, 5-20 locations (Scenario C profile).
- *Includes:* everything in Growth + multi-location consent/reviews, higher CDP volume ceiling, audit-log/DSAR consent tier, priority support.
- *Why this price:* Scenario C's assembled stack totaled ~$3,184/month. Even scaling AXIOM's Business tier with location count, it remains a fraction of that — mainly because AXIOM avoids the Podium/Birdeye opacity tax and the separate enterprise CDP contract this scenario otherwise requires.

**4. Agency White-Label — $449/month**
- *Who:* agencies managing 10-50 client accounts (Scenario D profile).
- *Includes:* unlimited sub-accounts, white-label branding, per-client CDP + consent + email, reseller billing.
- *Why this price:* Positioned below the $497-499/month GoHighLevel/Vendasta anchor (a credible switch incentive) while covering categories neither offers (CDP, consent, forecasts, social intelligence) — avoiding both DashClicks' underpricing (leaves margin on the table given AXIOM's wider scope) and SharpSpring's fate (high price, no differentiation, discontinued 2026).

**5. Multi-Location / Enterprise — from $1,499/month or custom per-location**
- *Who:* 20+ locations, or agencies with 50+ clients.
- *Includes:* dedicated deployment, SSO, custom SLA, volume-based per-location/per-client pricing.
- *Why this price:* Matches where every category in this research ultimately lands (custom quote) — but AXIOM should publish a clear *starting* number, unlike OneTrust/Bloomreach/mParticle/Salesforce MCI/Adobe CJA, which publish nothing at all. Transparency itself is a differentiator in a category that has trained buyers to expect a black box past the entry tier.

### 9.2 Pricing Mechanics

| Question | Recommendation | Why |
|---|---|---|
| Price by contacts? | **Yes, primary metric** | Matches CDP/email industry convention (Segment, Klaviyo, HubSpot all do this) — familiar to buyers. |
| Price by locations? | **Yes, secondary metric for Business tier** | Matches booking/reviews convention (Square, Reputation.com) — the natural unit at multi-location scale. |
| Price by domains? | No, only as an internal sub-metric within Consent | Consent-specific vendors (CookieYes, Termly) price this way, but it's too narrow as a whole-platform metric. |
| Price by events? | No, as a customer-facing metric | Too CDP-infrastructure-wonky for SMB buyers (though fine as an internal capacity/throttling unit). |
| SMS/WhatsApp pass-through? | **Yes — thin markup, no big bundled allotment** | Every vendor researched eventually meters; country/carrier cost variance makes a flat allowance a margin risk (Section 4.4). |
| Social Recon included or add-on? | **Included at Growth tier+** | Differentiates vs. paying separately for Brand24/Mention; matches AXIOM's cross-referencing advantage. |
| Consent included in every plan? | **Banner-only: yes, every plan.** Audit-log/DSAR: Business tier+. | Matches the proven market split (Section 4.8) — banner is a commodity trust signal, DSAR is the premium layer. |
| Reviews included or add-on? | **Included (lite) at Growth tier+** | Cheap to build as a bolt-on (Section 4.6); don't chase Podium/Birdeye's opaque premium tier. |
| White-label a separate plan? | **Yes, distinct Agency tier** | Matches GoHighLevel/Vendasta's own structural choice — gating white-label to a materially different tier, not a checkbox on a regular plan. |

---

## 10. Positioning Recommendations

**What AXIOM should NOT be positioned as:**
- Not another Mailchimp/Klaviyo — email alone is commoditized and compresses toward $0-100/month at the entry tier everywhere.
- Not another Calendly — booking is a proven $0-60/month commodity; charging for it directly fights market gravity.
- Not a Brandwatch/Meltwater competitor — their moat is a decade of data-licensing contracts, not software AXIOM can out-build.
- Not a OneTrust replacement — enterprise privacy-ops breadth (100+ connectors, dedicated legal ops) is a different business than AXIOM's SMB motion.
- Not a pure Segment/RudderStack replacement — raw pipe-and-destinations is commoditized and well-served by two mature, well-funded vendors.
- Not a Podium/Birdeye reputation-management replacement — their real wedge is a full communications platform (texting/webchat), not reviews.
- Not a Triple Whale/Northbeam pure-attribution tool — attribution alone is commoditizing fast at the entry tier.

**Sharper positioning statements:**
1. "AXIOM is the only Revenue OS that bundles identity stitching into the base price — everyone else (Segment, RudderStack, Hightouch) sells you the pipe and makes you pay enterprise money to know who's actually on the other end."
2. "AXIOM turns churn prediction and repeat-sale prioritization — a feature buried inside $80K-$180K/year enterprise suites everywhere else researched — into a standard part of a $249/month plan."
3. "AXIOM is the Revenue OS for the business that's outgrown free tools but isn't ready for a six-vendor stack and a six-figure enterprise contract."
4. "AXIOM prices white-label agency access below GoHighLevel's real anchor price ($497/mo) while including categories GoHighLevel doesn't touch — CDP, forecasts, social intelligence, consent."
5. "AXIOM treats consent as a data-unification problem, not a banner-rental problem — the same profile that holds a customer's purchase history also holds their consent status and audit trail, which is exactly the expensive 'Premium/Corporate' feature OneTrust and Usercentrics gate behind enterprise pricing."
6. "AXIOM doesn't compete on being the cheapest email tool, the cheapest scheduler, or the cheapest cookie banner — it competes on being the only place all of those already know the same customer."
7. "Nine of the ten categories in this market hide their real price once you look serious enough to need it — AXIOM's pricing stays public through the tier that actually matters to a growing business."

---

## 11. Risks and Pricing Traps

- **Why selling booking alone is a weak idea:** Section 4.5 shows it's a $0-60/month commodity monetized everywhere via adjacency (payment processing, CRM routing, HIPAA compliance) — never the scheduling mechanic itself. Charging a premium standalone price fights the entire market's pricing gravity.
- **Why selling email alone creates a race to the bottom:** Free tiers are near-universal (Klaviyo, Brevo, Mailchimp, Omnisend); the only real differentiation incumbents have found is ecommerce depth (Klaviyo/Shopify) or CRM/CMS ecosystem breadth (HubSpot) — neither of which is "email" as a category.
- **Why selling CDP alone is too abstract for SMB:** Nobody in this research buys "unified customer profile" as a first purchase — even Segment and RudderStack sell it as "pipeline"/"event streaming" at the accessible tier, reserving the word "CDP" (and identity resolution) for the enterprise conversation. AXIOM must sell the *outcome* (know your customer, feed every product from one profile), not the infrastructure noun.
- **Why social listening sold like Brandwatch is too expensive/complex for SMB:** The category's real moat is a decade of licensed data-firehose contracts (X/Reddit/TikTok/news archives), not UI or AI — a cost structure that forces $10K-150K+/year, quote-only pricing. AXIOM has no such contracts and shouldn't pretend to.
- **Why consent alone is cheap unless tied to proof/compliance:** The banner-only tier is a converged $5-15/month commodity (five vendors). The only lever with real pricing power is the audit-log/DSAR layer, which the market treats as an entirely different (usually quote-based) product line, not a modest tier bump.
- **Why reviews can be a high-value add-on:** Podium/Birdeye prove opacity-priced reviews can extract $300-600+/month — but only bundled with communications-platform breadth (texting/webchat) that AXIOM shouldn't try to replicate. AXIOM should offer reviews-lite bundled (matching NiceJob/Grade.us's $75-99/month scope), not chase the premium tier.
- **Why agencies may pay more for white-label + client-ready reporting:** GoHighLevel and Vendasta both prove a real, durable $497-499/month anchor exists — but SharpSpring's 2026 discontinuation at a similar price point with less differentiation is a live cautionary tale. Price near that anchor only with genuinely wider scope (CDP + consent + forecasts), not just CRM/funnels.

---

## 12. Final Conclusion

Across 63 vendors and 10 categories, the market draws a remarkably consistent line: **cheap, self-serve, often-free pricing for the "dumb" layer of every category (raw pipes, basic sends, a calendar, a banner, publishing tools), and either an enterprise quote or a 5-10x tier jump for the "smart" layer (identity resolution, churn prediction, audit-log/DSAR, real listening, white-label reselling).** AXIOM's structural bet — that owning the unified customer profile lets it deliver the expensive layer at a price close to the cheap layer — is directly supported by every category researched, not just asserted. The stack-cost simulations (Section 7) show the gap concretely: businesses assembling AXIOM's equivalent capability from point tools pay anywhere from ~$19/month (smallest SMB) to over $38,000/year (multi-location), often without ever getting a real identity-stitched profile or any churn/forecast signal at all, because no researched competitor sells that combination affordably.

**Recommended pricing range: $79/month (Starter) to $599+/month (Business), $449/month (Agency white-label), custom from $1,499/month (Enterprise) — published and transparent through the tier that matters, in a market where nine of ten categories go dark on price past the entry rung.**

**Best one-liner:** *"Instead of paying separately for Klaviyo, Calendly, Cookiebot, a Podium-lite reviews tool, and a Segment-lite CDP — plus a six-figure enterprise contract the moment you need churn prediction or a real consent audit trail — AXIOM gives SMBs and agencies one Revenue OS with all of that built in, priced like the point tools, not the enterprise suites."*

---

## 13. Source List

All sources are linked inline in Sections 4 and 5 at the point of use. Full list of primary domains consulted (official vendor pricing pages unless marked otherwise):

klaviyo.com/pricing · brevo.com/pricing · mailchimp.com/pricing · omnisend.com/pricing · activecampaign.com/pricing · customer.io/pricing · hubspot.com/pricing/marketing · vendr.com/marketplace/iterable · vendr.com/marketplace/braze · twilio.com/sms/pricing · twilio.com/whatsapp/pricing · twilio.com/products/connections/pricing · ortto.com/pricing · bloomreach.com/en/pricing · useinsider.com/pricing · mparticle.com/pricing · treasuredata.com/product/pricing · rudderstack.com/pricing · hightouch.com/pricing · calendly.com/pricing · acuityscheduling.com/signup.php · capterra.com (Square Appointments, Appointy pricing listings) · setmore.com/pricing · simplybook.me/en/pricing · podium.com/getpricing · birdeye.com/pricing · reputation.com/pricing · yext.com/pl/plans.html · get.nicejob.com/pricing · business.trustpilot.com/pricing · grade.us/home/plans · hootsuite.com/plans · sproutsocial.com/pricing · brandwatch.com/plans · meltwater.com/en/pricing · talkwalker.com/pricing · mention.com/en/pricing · brand24.com/pricing · buffer.com/pricing · later.com/pricing · cookiebot.com/us/pricing · usercentrics.com/pricing · onetrust.com/pricing · didomi.io/offers · enzuzo.com/blog/osano-pricing (third-party) · cookieyes.com/pricing · termly.io/pricing · iubenda.com/en/pricing · gohighlevel.com/pricing · vendasta.com/pricing · dashclicks.com/pricing · agencyanalytics.com/pricing · constantcontact.com/pricing/lead-gen-crm · systeme.io/pricing · triplewhale.com/pricing · northbeam.io/pricing · wickedreports.com/pricing · hyros.com/pricing-ai-tracking · mixpanel.com/pricing · amplitude.com/pricing · pricingnow.com (third-party, Salesforce MCI) · business.adobe.com/products/adobe-analytics/customer-journey-analytics.html · en.axiom.rent (all subpages: /platform, /products, /pero, /smm, /forecasts, /booking, /consent)

*Research conducted via 11 parallel research agents (1 site-analysis + 10 category specialists), each instructed to prioritize official vendor pricing pages via WebFetch, fall back to named third-party sources only where no official number exists, and flag explicitly wherever no number of any kind could be found.*
