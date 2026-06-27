# RF CDP — email-ai (152-ФЗ)

AI email-marketing composer for the RF segment. Selects lifecycle-trigger
recipients from the **profile-engine**, gates them on **marketing consent** via
the **consent-ledger**, generates Russian copy (Flot LLM with a deterministic
fallback), and enforces the «О рекламе» (ст. 18) footer. **Delivery is handed to
Dittofeed** — this service composes and dry-runs; it does not send ESP mail.

## Provenance & charter

- **generators** + **triggers** ported from US `modules/email` (structure is
  law-agnostic) — but the **copy is rebuilt in Russian** and the AI system prompt
  is rebuilt for 152-ФЗ. `AiGatewayGenerator` is OpenAI-compatible → points at Flot.
- **CAN-SPAM → `compliance.enforce152fz`**: «О рекламе» ст. 18 requires operator
  identification + a working unsubscribe; consent itself is a separate gate.
- **campaign**: the marketing-consent gate is **mandatory and fail-closed** —
  a recipient is emailed only when the consent-ledger returns a **verified** chain
  whose state allows `marketing_email`. Missing/unverified/unreachable ⇒ skipped.

## API (loopback :8150)

- `GET  /v1/health`
- `POST /v1/campaign/preview {site, trigger, brandName, from, operator, unsubscribeUrl, productName?, ctaUrl?, useAi?}`
  → dry-run: `{profiles, selected, sent, skippedNoConsent, sample[]}` with composed,
  footer-enforced HTML. `trigger ∈ {welcome, abandoned_cart, reactivation}`.
- `POST /v1/campaign/send` → `501` (Dittofeed delivery wiring is a follow-up).

## Status

**✅ Verified locally** — `node --test` → **19 pass / 0 fail**: triggers (selection),
compliance (footer enforced / throws on missing operator|unsubscribe), generators
(RU template determinism + AI parse + offline fallback), campaign (consent gate
counts + footer on every message), and a worker integration test driving
`previewCampaign` against fake profile-engine + consent-ledger (incl. fail-closed
on unverified/missing consent).

**Deploy:** `cdp-email-ai-1` (:8150) talks to `profile-engine:8130` + `consent-ledger:8140`
over the stack network. `AI_GATEWAY_URL` empty ⇒ deterministic RU template; set it to
a Flot endpoint (reverse tunnel) to enable LLM copy.

**Next:** wire real Dittofeed transactional send for `/v1/campaign/send`; Flot tunnel
for AI copy.

## Run tests

```bash
cd rf-cdp/services/email-ai
node --test
```
