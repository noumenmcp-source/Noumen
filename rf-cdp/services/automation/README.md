# RF CDP — automation

Social + messenger automation for the RF segment: runs a scenario of steps
(`social_post`, `messenger_send`, `wait`) through channel adapters, enforcing a
**152-ФЗ / «О рекламе» marketing-messaging consent gate** on advertising
messenger sends.

## Provenance & charter

- **orchestrator** + **adapters** ported from US `modules/automation` (law-agnostic
  step runner + injectable channel interfaces).
- **US TCPA gate (`messaging_tcpa`) → 152-ФЗ `marketing_messaging`**: a marketing
  `messenger_send` is delivered only when the consent-ledger returns a **verified**
  chain allowing `marketing_messaging`. Missing/unverified/no-checker ⇒ **skipped**
  (`reason: messaging_consent_missing`). Transactional (non-marketing) sends are
  not gated. (Adds `marketing_messaging` to the consent-ledger purpose set.)

## API (loopback :8170)

- `GET  /v1/health`
- `POST /v1/automation/run {site, steps[]}` → dry-run via in-memory adapters:
  `{summary:{posted,sent,skipped}, results[], posts[], messages[]}`.

## Status

**✅ Verified locally** — `node --test` → **8 pass / 0 fail**: orchestrator
(social_post→posted, marketing send without consent→skipped, with consent→sent,
transactional not gated, wait→waited + order preserved, fail-closed when no
checker), adapters (deterministic ids), and a worker integration test gating
marketing sends against a fake consent-ledger.

**Next:** real channel adapters (Telegram bot / VK) behind the same interfaces;
scenario scheduling.

## Run tests

```bash
cd rf-cdp/services/automation
node --test
```
