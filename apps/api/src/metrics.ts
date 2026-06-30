import type { FastifyInstance } from "fastify";

/**
 * Tiny in-process Prometheus metrics registry. No external dependency and no
 * credentials — `/metrics` is a scrape target (typically firewalled to the
 * metrics network). Exposes only aggregate counters (no PII, no per-tenant data).
 */
export interface MetricsRegistry {
  /** Count one finished request by its HTTP status class (2xx/3xx/4xx/5xx). */
  incRequest(statusCode: number): void;
  /** Render the Prometheus text exposition (version 0.0.4). */
  render(): string;
}

const STATUS_CLASSES = ["2xx", "3xx", "4xx", "5xx"] as const;
type StatusClass = (typeof STATUS_CLASSES)[number];

function statusClass(code: number): StatusClass {
  if (code >= 500) return "5xx";
  if (code >= 400) return "4xx";
  if (code >= 300) return "3xx";
  return "2xx";
}

/**
 * @param extraCounters optional snapshot of additional gauges/counters to expose
 *   under `cdp_ingest_events_total{outcome=...}` (e.g. the ingest pipeline tallies).
 */
export function createMetricsRegistry(extraCounters?: () => Record<string, number>): MetricsRegistry {
  const requests: Record<StatusClass, number> = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };

  return {
    incRequest(statusCode: number): void {
      requests[statusClass(statusCode)] += 1;
    },
    render(): string {
      const lines: string[] = [];
      lines.push("# HELP cdp_http_requests_total Total HTTP requests by status class.");
      lines.push("# TYPE cdp_http_requests_total counter");
      for (const cls of STATUS_CLASSES) {
        lines.push(`cdp_http_requests_total{status_class="${cls}"} ${requests[cls]}`);
      }
      const extra = extraCounters?.() ?? {};
      const outcomes = Object.keys(extra);
      if (outcomes.length > 0) {
        lines.push("# HELP cdp_ingest_events_total Ingest pipeline counters by outcome.");
        lines.push("# TYPE cdp_ingest_events_total counter");
        for (const outcome of outcomes) {
          lines.push(`cdp_ingest_events_total{outcome="${outcome}"} ${extra[outcome] ?? 0}`);
        }
      }
      return lines.join("\n") + "\n";
    },
  };
}

/**
 * Register an `onResponse` counter hook and a `GET /metrics` scrape endpoint.
 *
 * @example registerMetrics(app, createMetricsRegistry(() => counters));
 */
export function registerMetrics(app: FastifyInstance, registry: MetricsRegistry): void {
  app.addHook("onResponse", async (_req, reply) => {
    registry.incRequest(reply.statusCode);
  });
  app.get("/metrics", async (_req, reply) => {
    return reply.header("content-type", "text/plain; version=0.0.4; charset=utf-8").send(registry.render());
  });
}
