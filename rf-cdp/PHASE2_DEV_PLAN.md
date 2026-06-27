# CDP Phase 2 — Development Plan (2026-06-19)

Sequenced, verifiable build plan across 9 workstreams. Produced + structured by a 10-agent workflow.
Anchored on the FINAL architecture (`PHASE2_ARCHITECTURE.md`): one Beget RU box, AES, no cross-border,
RU ESP, foreign cloud = non-personal only. Every acceptance criterion is machine-checkable (curl/HTTP code,
grep, db/ES query, exit code). Owner types: `claude-implements` / `user-decision` / `prod-gated`.

Workstreams: ESP-swap (ESP-*), Deliverability (DEL-*), Durability (DUR-*), OIDC-admin (OIDC-*),
Infra/RAM (RAM-*) → Phase 2A · Intelligence (INT-*), Content-AI (CAI-*), Journeys (JNY-*) → 2B ·
Experiments+Attribution (EXP-*) → 2C.

## Milestones
- **M0 — Foundations laid** (specs, baselines, abstract interfaces): RAM-0, DUR-0, OIDC-1, ESP-0, ESP-1,
  DEL-0, INT-0, CAI-1, JNY-0, EXP-1, RAM-1, DUR-1, OIDC-0. DoD: all baseline/inventory files exist and
  grep-validate; ram_sizing budget ≤95%; SPEC signed.
- **M1 — RAM relief applied** (the unblocking gate): RAM-2. DoD: `/proc/meminfo` MemTotal ≥ target×0.95.
  Single prod gate that unblocks EE swap, Redpanda broker, encryption-at-rest.
- **M2 — Phase 2A foundation complete** (RF-resident, secure, durable, multi-tenant, deliverable):
  ESP-9, DEL-10, DUR-9, DUR-10, OIDC-11, OIDC-12, RAM-9, RAM-8. DoD: prod send via RF relay → RU ESP
  arrives DKIM=pass, ES _count by message-id ≥1 on every tenant, 0 `resend` in active config; tenant
  isolation symmetric; residency canary 0 PII off-box.
- **M3 — Phase 2B live** (intelligence + content + journeys): 7 trait/score families in ClickHouse +
  Dittofeed props feeding ≥3 score-driven segments; propensity AUC ≥0.65; journeys Running with
  behavioral proofs; AI content with LLM-judge QA gating sends.
- **M4 — Phase 2C closed** (experiments + attribution loop): full lifecycle exit 0 — 3-arm+holdout within
  ±1% (holdout sends==0), tagged event chain matches fixture, incrementality CI computed, revenue loops
  back into Profile + Delivery tiers.

## Critical path
`RAM-0 → RAM-1 → RAM-2 → OIDC-0 → OIDC-8 → DUR-1 → DUR-2 → DUR-4 → DUR-5 → DUR-6 → DUR-7 → DUR-9 → INT-1 →
INT-3 → INT-7 → INT-9 → EXP-5 → EXP-6 → EXP-7 → EXP-9`
The early chain is RAM (sizing→order→upgrade) because the box at 766/768 gates all heavy prod work.

## Build sequence (machine-checkable gate between steps)
1. **Foundation baseline** — RAM-0, DUR-0, OIDC-1, ESP-0, ESP-1, DEL-0, INT-0, CAI-1, JNY-0, EXP-1.
2. **RAM sizing + orders** — RAM-1, OIDC-0, DUR-1, ESP-2/5, DEL-1/6, INT-1/2, CAI-2/3.
3. **RAM upgrade applied** — RAM-2 (hard prod gate; MemTotal ≥ target×0.95).
4. **2A relay + backbone build** — ESP-3/4, DUR-2/3, DEL-2/3, OIDC-2/3/4, RAM-5/6 (Dittofeed provider=Smtp,
   no resend; Redpanda Healthy; PII reads = ciphertext).
5. **2A consumers + OIDC up** — DUR-5/6/4/8, DEL-4/7, OIDC-5/6/7, RAM-7/3/4 (es-sink idempotent LAG=0;
   webhook→suppression <60s; Dex issuer match; render/observability in cloud, 0 PII).
6. **2A send-loop + EE cutover** — ESP-6/7, DUR-7, DEL-8/9, OIDC-8/9/10, RAM-8 (txn+mkt send DKIM=pass;
   chaos DLQ==0; EE multi-tenant; OIDC login 302→dashboard).
7. **2A isolation + residency + prod cutovers** — OIDC-11/12, ESP-8, DEL-5/10, RAM-9 (admin A sees only
   site A; relay→ESP works while api.resend.com fails; residency canary 0 PII).
8. **2A prod send + durability final** — ESP-9, DUR-9/10 (every tenant provider=Smtp; DIRECT_PATH=off,
   soak diff==0). **→ PHASE 2A COMPLETE.**
9. **2B intelligence** — INT-3/4/5/6/7/8/12/13.
10. **2B content-AI + propensity** — INT-9/10/11, CAI-4..10 (AUC≥0.65; QA gates sends; token-resolver RF-only).
11. **2B journeys** — JNY-1..10 (cap/quiet/holdout policy; behavioral proofs from demo profiles).
12. **2B content prod + white-label** — CAI-11, JNY-11/12/13. **→ PHASE 2B COMPLETE.**
13. **2C experiments engine** — EXP-2/3/4/5/6 (assignment determinism; bandit; tagged event chain).
14. **2C gating + attribution loopback** — EXP-7..13. **→ PHASE 2C COMPLETE.**

## Startable NOW (no unmet deps, claude-implements, non-destructive)
RAM-0, DUR-0, OIDC-1, ESP-1 (+ specs INT-0, CAI-1, JNY-0, EXP-1, DEL-0 once formulas signed).

## 🔴 Blocked on user decisions (longest-lead — resolve in parallel with M0)
- **ESP-0** — final RU/EAEU ESP + prod account + API/SMTP creds (gates ESP-2..9, DEL-2+, CAI-10, JNY-13).
- **OIDC-0** — Dittofeed EE resale license + registry creds to pull the EE image (gates the whole OIDC
  workstream + AUTH_MODE=multi-tenant that all 2B/2C multi-tenant work assumes).
- **RAM-2** — Beget paid plan upgrade approval (the single RAM-relief lever; gates EE swap, broker,
  encryption-at-rest, scoring).
- **DEL-0** — ESP signing-model GO/NO-GO for own-domain DKIM (gates DMARC alignment + BIMI).
- **DEL-5** — VMC per tenant for BIMI (cost; BIMI ships without it for RU mailbox providers).
- **INT-0 / INT-9** — trait/score formula catalog + propensity model & threshold policy.
- **JNY-2** — per-workspace frequency-cap / quiet-hours / holdout_pct values.

## First actions (this session)
1. RAM-0 — capture `free -m`, `docker stats`, ES heap/RSS, swap, OOM history → `deploy/baseline_mem.txt`
   + build `deploy/pii_inventory.csv` (the PII contract all encryption/residency checks grade against).
2. DUR-0 — document AS-IS ingest path + peak events/sec, ES `cdp_events` _count, free RAM/disk →
   `deploy/durability/BASELINE.md` (the no-loss reconciliation baseline).
3. ESP-1 — scaffold `cdp/services/esp-relay/` with `ProviderAdapter` interface + NullAdapter, `tsc --noEmit`
   exit 0 (de-risks the pending ESP-0 selection).
4. Surface the 3 hard decision gates (ESP-0, OIDC-0, RAM-2) to the owner to resolve in parallel.

Full per-task detail (deps, acceptance criteria, effort) — in the dev-plan workflow transcript.
See `PHASE2_ARCHITECTURE.md`, `deploy/oidc/`, `mem:research/cdp-phase2-architecture`.
