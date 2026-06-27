# DUR-0 — durability baseline (AS-IS), 2026-06-19

Pre-cutover reference for the no-event-loss proof once the Redpanda backbone (DUR-1..DUR-10) lands.

## AS-IS ingest path (no backbone yet)
storefront → `POST /v1/track|/v1/identify` (ingest-gateway :8110) → ONE bounded in-memory queue
(`QUEUE_MAX=100000`) → drain workers → (a) ES bulk write `cdp_events_<site>` + (b) forward to Dittofeed.
- **Loss window:** the queue is in-memory. A gateway crash / OOM / restart drops whatever is queued
  (`pending`/`inflight`) — at-most-once under failure. No DLQ. This is exactly what DUR replaces.
- Backpressure: queue full → HTTP 503 (does not grow RAM). Forward failures are not durably retried.

## Measured baseline (machine-readable, from RAM-0 capture 2026-06-19T18:22Z)
- ES `cdp_events_zavod` _count = **58** docs (40.4kb); `cdp_suppressions` = 1.
- Gateway `/v1/health`: stored=forwarded, failed=0, dropped=0, queued=0 (counters reset on restart).
- Peak events/sec: LOW (test/demo traffic only; go-live just happened). Re-measure under real load before
  sizing partitions/throughput.
- Disk: 15G/40G used (25G free) — ample for a broker's local log.

## ⚠️ Reliability finding (RAM-0)
Kernel OOM-killer has ALREADY killed Elasticsearch (`Killed process 4212 (java)`, memcg OOM) once this
boot. ES sits at 766/768 MiB (heap 60% of 384m). Any added load (EE multi-tenant, a broker) without the
M1 RAM upgrade risks repeat OOM → data-plane outage. **A broker must NOT be co-located until M1 (RAM-2)
is applied**, or it must run with a hard, tested memory cap that the box can honor.

## No-loss proof (to run after DUR cutover)
Reconciliation: with `DIRECT_PATH=off, BACKBONE_PRODUCE=on`, replay N events → assert
ES `_count` delta == N, Dittofeed distinct messageId == N, consumer LAG == 0, DLQ depth == 0, and a
crash-injection (kill broker/consumer mid-stream) still yields delta == N after recovery (DUR-9/DUR-10).
