import { describe, expect, it } from "vitest";
import { buildServer } from "./server.js";
import type {
  ObservabilityErrorEvent,
  ObservabilityRequestEvent,
  ObservabilitySink,
} from "./observability.js";

function captureSink() {
  const requests: ObservabilityRequestEvent[] = [];
  const errors: ObservabilityErrorEvent[] = [];
  const sink: ObservabilitySink = {
    captureRequest: (event) => {
      requests.push(event);
    },
    captureError: (event) => {
      errors.push(event);
    },
  };
  return { sink, requests, errors };
}

describe("observability", () => {
  it("is a no-op when Sentry and OTel env are absent", async () => {
    const events = captureSink();
    const app = await buildServer({
      logger: false,
      observability: { env: {}, sink: events.sink },
    });

    const res = await app.inject({ method: "GET", url: "/v1/health" });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(events.requests).toEqual([]);
    expect(events.errors).toEqual([]);
  });

  it("records request and error events when Sentry or OTel env is present", async () => {
    const events = captureSink();
    const app = await buildServer({
      logger: false,
      observability: {
        env: {
          NODE_ENV: "production",
          OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example/v1/traces",
          SENTRY_DSN: "https://public@example.ingest.sentry.io/1",
        },
        sink: events.sink,
      },
    });
    app.get("/boom", async () => {
      throw new Error("boom");
    });

    const ok = await app.inject({ method: "GET", url: "/v1/health" });
    const boom = await app.inject({ method: "GET", url: "/boom" });
    await app.close();

    expect(ok.statusCode).toBe(200);
    expect(boom.statusCode).toBe(500);
    expect(events.requests).toEqual([
      expect.objectContaining({
        environment: "production",
        method: "GET",
        path: "/v1/health",
        serviceName: "cdp-us-api",
        statusCode: 200,
        targets: { otel: true, sentry: true },
      }),
      expect.objectContaining({
        method: "GET",
        path: "/boom",
        statusCode: 500,
      }),
    ]);
    expect(events.errors).toEqual([
      expect.objectContaining({
        errorMessage: "boom",
        errorName: "Error",
        method: "GET",
        path: "/boom",
        targets: { otel: true, sentry: true },
      }),
    ]);
  });

  it("uses the default HTTP transport when env is enabled and no sink is provided", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ body: string; contentType: string; url: string }> = [];
    globalThis.fetch = (async (input, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      calls.push({
        body: String(init?.body ?? ""),
        contentType: headers?.["content-type"] ?? "",
        url: String(input),
      });
      return { ok: true, status: 202 } as Response;
    }) as typeof fetch;

    try {
      const app = await buildServer({
        logger: false,
        observability: {
          env: {
            NODE_ENV: "production",
            OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example/v1/traces",
            SENTRY_DSN: "https://public@example.ingest.sentry.io/1",
          },
        },
      });
      app.get("/boom", async () => {
        throw new Error("boom");
      });

      const ok = await app.inject({ method: "GET", url: "/v1/health" });
      const boom = await app.inject({ method: "GET", url: "/boom" });
      await app.close();

      expect(ok.statusCode).toBe(200);
      expect(boom.statusCode).toBe(500);
      expect(calls.filter((call) => call.url === "https://otel.example/v1/traces"))
        .toHaveLength(3);
      expect(
        calls.some(
          (call) =>
            call.url === "https://example.ingest.sentry.io/api/1/envelope/" &&
            call.contentType === "application/x-sentry-envelope" &&
            call.body.includes("boom"),
        ),
      ).toBe(true);
      expect(
        calls.some(
          (call) =>
            call.contentType === "application/json" &&
            call.body.includes("http.server.request"),
        ),
      ).toBe(true);
      expect(
        calls.some(
          (call) =>
            call.contentType === "application/json" &&
            call.body.includes("http.server.error"),
        ),
      ).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
