# ingest-gateway v2 — load test results (2026-06-19)

Local benchmark (mock-ES instant-200, forward OFF) — measures the ingest + bulk-raw ceiling,
the path that was the root bottleneck. Harness: `loadtest.js` (same profile as the dev team's test).

| target/s | achieved/s | err | timeout | p50 | p99 | queue after |
|---|---|---|---|---|---|---|
| 200 | 200 | 0 | 0 | 2.0ms | 9ms | 2 |
| 800 | 799 | 0 | 0 | 2.4ms | 62ms | 0 |
| 2000 | 1973 | 0 | 0 | 5.5ms | 609ms | 0 |
| 5000 | **4994** | 0 | 0 | 13.1ms | 750ms | 0 |

## Before → after (dev team measured the v1)
| | v1 (single worker, per-doc ES, sync forward, per-req pino) | v2 |
|---|---|---|
| 2000/s | 684/s, p99 10.3s, 16 timeouts, queue 14.5k | 1973/s, p99 609ms, 0 timeouts |
| 5000/s | did not reach | 4994/s, p99 750ms, 0 err, queue→0 |
| ingest ceiling | ~700/s | ~5000/s (7×) |

## What fixed it
- `logger:false` — removed per-request pino (the main ingest bottleneck)
- raw decoupled from forward: ES `_bulk` batching (1000 docs / 200ms) instead of per-doc POST
- forward-pool (32 concurrent) — own bounded queue, never blocks ingest
- bounded ring-queue (100k) + HTTP 429 on overflow — no unbounded RAM growth

## Honest scope
- mock-ES + forward OFF = pure ingest+bulk-raw ceiling (the root defect). Real ES slightly slower; bulk holds.
- Forward to Dittofeed still downstream-bound: ~thousands/s via LOCAL Dittofeed, ~5/s via cloudflared tunnel.
  But forward no longer throttles ingest — raw persists at 5000/s regardless; forward drains at its own pace.
- For zero-loss durability under crash: bounded in-memory queue is not durable — Kafka/Redpanda (F0 backbone)
  or a WAL is the next step (see Flot architectural review).
