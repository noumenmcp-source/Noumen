Email platform architecture notes for `cdp`:
- Core objects: lists, audiences, static/dynamic segments, subscribers, preferences, suppression lists.
- Deliverability state: bounces, complaints, unsubscribe, double opt-in, sender reputation, IP/domain warming.
- Template stack: MJML, HTML, markdown, reusable blocks, personalization, merge tags.
- Automation: journeys, drip campaigns, triggers, webhooks, APIs, provider adapters.
- Sending layer: SMTP or provider abstraction (Postal/SES/SendGrid/Mailgun/Postmark/Resend-style connectors).
- Operational concerns: queues, rate limiting, retry, deduplication, idempotency, click/open tracking, UTM, dashboards.

Practical rule: do not build SMTP infrastructure from scratch unless the product itself is an ESP. Focus on orchestration, UX, and deliverability hygiene.