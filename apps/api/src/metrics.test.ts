import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { createMetricsRegistry, registerMetrics } from "./metrics.js";

describe("createMetricsRegistry", () => {
  it("buckets requests by status class and renders Prometheus text", () => {
    const reg = createMetricsRegistry();
    reg.incRequest(200);
    reg.incRequest(204);
    reg.incRequest(404);
    reg.incRequest(503);
    const out = reg.render();

    expect(out).toContain("# TYPE cdp_http_requests_total counter");
    expect(out).toContain('cdp_http_requests_total{status_class="2xx"} 2');
    expect(out).toContain('cdp_http_requests_total{status_class="4xx"} 1');
    expect(out).toContain('cdp_http_requests_total{status_class="5xx"} 1');
    expect(out.endsWith("\n")).toBe(true);
  });

  it("exposes extra ingest counters when provided", () => {
    const reg = createMetricsRegistry(() => ({ received: 7, failed: 1 }));
    const out = reg.render();
    expect(out).toContain('cdp_ingest_events_total{outcome="received"} 7');
    expect(out).toContain('cdp_ingest_events_total{outcome="failed"} 1');
  });
});

describe("registerMetrics", () => {
  it("serves /metrics and counts the requests it sees", async () => {
    const app = Fastify();
    registerMetrics(app, createMetricsRegistry());
    await app.inject({ method: "GET", url: "/metrics" }); // counted as a 2xx
    const res = await app.inject({ method: "GET", url: "/metrics" });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.headers["content-type"]).toContain("version=0.0.4");
    // The first /metrics response (a 2xx) was counted before the second scrape.
    expect(res.body).toContain('cdp_http_requests_total{status_class="2xx"} 1');
  });
});
