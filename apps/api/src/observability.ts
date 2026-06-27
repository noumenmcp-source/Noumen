import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";

type ObservabilityEnv = Partial<Record<string, string | undefined>>;

export type ObservabilityTargets = Readonly<{ sentry: boolean; otel: boolean }>;

export type ObservabilityConfig = Readonly<{
  enabled: boolean;
  environment: string;
  serviceName: string;
  targets: ObservabilityTargets;
}>;

export type ObservabilityRequestEvent = Readonly<{
  durationMs: number;
  environment: string;
  method: string;
  path: string;
  requestId: string;
  serviceName: string;
  statusCode: number;
  targets: ObservabilityTargets;
}>;

export type ObservabilityErrorEvent = Readonly<{
  environment: string;
  errorMessage: string;
  errorName: string;
  errorStack?: string;
  method: string;
  path: string;
  requestId: string;
  serviceName: string;
  targets: ObservabilityTargets;
}>;

export type ObservabilitySink = Readonly<{
  captureRequest(event: ObservabilityRequestEvent): void | Promise<void>;
  captureError(event: ObservabilityErrorEvent): void | Promise<void>;
}>;

export type ObservabilityOptions = Readonly<{
  env?: ObservabilityEnv;
  sink?: ObservabilitySink;
}>;

type ObservabilityRuntimeConfig = ObservabilityConfig &
  Readonly<{
    otelEndpoint?: string;
    sentryDsn?: string;
  }>;
type OtelAttribute = Readonly<{
  key: string;
  value: Readonly<{ stringValue: string } | { intValue: string }>;
}>;

export function createObservabilityConfig(
  env: ObservabilityEnv = process.env,
): ObservabilityConfig {
  const { otelEndpoint: _otelEndpoint, sentryDsn: _sentryDsn, ...config } =
    resolveObservabilityConfig(env);
  return config;
}

function resolveObservabilityConfig(
  env: ObservabilityEnv = process.env,
): ObservabilityRuntimeConfig {
  const sentryDsn = trim(env.SENTRY_DSN);
  const otelEndpoint = trim(env.OTEL_EXPORTER_OTLP_ENDPOINT);
  const serviceName =
    trim(env.OTEL_SERVICE_NAME) ?? trim(env.FLY_APP_NAME) ?? "cdp-us-api";
  const environment = trim(env.NODE_ENV) ?? "development";

  return {
    enabled: sentryDsn !== undefined || otelEndpoint !== undefined,
    environment,
    serviceName,
    targets: {
      sentry: sentryDsn !== undefined,
      otel: otelEndpoint !== undefined,
    },
    otelEndpoint,
    sentryDsn,
  };
}

export function installObservability(
  app: FastifyInstance,
  opts: ObservabilityOptions | false | undefined,
): ObservabilityConfig {
  const config = resolveObservabilityConfig(opts === false ? {} : opts?.env);
  if (!config.enabled) return config;

  const sink = opts === false ? undefined : opts?.sink;
  const fallbackSink = sink ?? networkSink(app, config);
  const starts = new WeakMap<FastifyRequest, number>();

  app.addHook("onRequest", (request, _reply, done) => {
    starts.set(request, Date.now());
    done();
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = starts.get(request) ?? Date.now();
    await capture(app, () =>
      fallbackSink.captureRequest({
        durationMs: Math.max(0, Date.now() - startedAt),
        environment: config.environment,
        method: request.method,
        path: requestPath(request),
        requestId: String(request.id),
        serviceName: config.serviceName,
        statusCode: reply.statusCode,
        targets: config.targets,
      }),
    );
  });

  app.addHook("onError", async (request, _reply, err) => {
    await capture(app, () =>
      fallbackSink.captureError({
        environment: config.environment,
        errorMessage: err.message,
        errorName: err.name,
        errorStack: err.stack,
        method: request.method,
        path: requestPath(request),
        requestId: String(request.id),
        serviceName: config.serviceName,
        targets: config.targets,
      }),
    );
  });

  return config;
}

function networkSink(
  app: FastifyInstance,
  config: ObservabilityRuntimeConfig,
): ObservabilitySink {
  return {
    captureRequest: async (event) => {
      if (config.otelEndpoint) {
        await sendBestEffort(app, () =>
          sendOtelSpan(config.otelEndpoint!, "http.server.request", event),
        );
      }
      app.log.info({ observability: event }, "request_observed");
    },
    captureError: async (event) => {
      await Promise.all([
        config.sentryDsn
          ? sendBestEffort(app, () => sendSentryError(config.sentryDsn!, event))
          : undefined,
        config.otelEndpoint
          ? sendBestEffort(app, () =>
              sendOtelSpan(config.otelEndpoint!, "http.server.error", event),
            )
          : undefined,
      ]);
      app.log.error({ observability: event }, "error_observed");
    },
  };
}

async function capture(
  app: FastifyInstance,
  write: () => void | Promise<void>,
): Promise<void> {
  try {
    await write();
  } catch (err) {
    app.log.warn({ err }, "observability_capture_failed");
  }
}

async function sendBestEffort(
  app: FastifyInstance,
  send: () => Promise<void>,
): Promise<void> {
  try {
    await send();
  } catch (err) {
    app.log.warn({ err }, "observability_transport_failed");
  }
}

function requestPath(request: FastifyRequest): string {
  const routePath = (request as FastifyRequest & { routeOptions?: { url?: string } })
    .routeOptions?.url;
  return routePath ?? request.url.split("?")[0] ?? request.url;
}

function trim(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

async function sendSentryError(
  dsn: string,
  event: ObservabilityErrorEvent,
): Promise<void> {
  const parsed = parseSentryDsn(dsn);
  if (!parsed) return;

  const envelope = [
    JSON.stringify({ dsn, sent_at: new Date().toISOString() }),
    JSON.stringify({ type: "event" }),
    JSON.stringify({
      event_id: randomHex(16),
      exception: {
        values: [
          {
            stacktrace: event.errorStack ? { frames: [] } : undefined,
            type: event.errorName,
            value: event.errorMessage,
          },
        ],
      },
      level: "error",
      platform: "node",
      request: {
        method: event.method,
        url: event.path,
      },
      tags: {
        request_id: event.requestId,
        service: event.serviceName,
      },
      timestamp: new Date().toISOString(),
      transaction: `${event.method} ${event.path}`,
      environment: event.environment,
    }),
  ].join("\n");

  await postJson(parsed.envelopeUrl, envelope, "application/x-sentry-envelope");
}

async function sendOtelSpan(
  endpoint: string,
  name: string,
  event: ObservabilityRequestEvent | ObservabilityErrorEvent,
): Promise<void> {
  const endedAt = Date.now();
  const durationMs = "durationMs" in event ? event.durationMs : 0;
  const startedAt = Math.max(0, endedAt - durationMs);
  const failed =
    "statusCode" in event ? event.statusCode >= 500 : event.errorMessage.length > 0;

  await postJson(
    endpoint,
    JSON.stringify({
      resourceSpans: [
        {
          resource: {
            attributes: [
              otelString("service.name", event.serviceName),
              otelString("deployment.environment", event.environment),
            ],
          },
          scopeSpans: [
            {
              scope: { name: "cdp-us-api.observability" },
              spans: [
                {
                  attributes: otelAttributes(event),
                  endTimeUnixNano: toUnixNano(endedAt),
                  kind: 2,
                  name,
                  spanId: randomHex(8),
                  startTimeUnixNano: toUnixNano(startedAt),
                  status: { code: failed ? 2 : 1 },
                  traceId: randomHex(16),
                },
              ],
            },
          ],
        },
      ],
    }),
    "application/json",
  );
}

function otelAttributes(
  event: ObservabilityRequestEvent | ObservabilityErrorEvent,
): OtelAttribute[] {
  const attrs: OtelAttribute[] = [
    otelString("http.request.method", event.method),
    otelString("url.path", event.path),
    otelString("cdp.request_id", event.requestId),
  ];

  if ("statusCode" in event) {
    attrs.push(otelInt("http.response.status_code", event.statusCode));
  } else {
    attrs.push(
      otelString("exception.type", event.errorName),
      otelString("exception.message", event.errorMessage),
    );
  }

  return attrs;
}

function otelString(key: string, value: string): OtelAttribute {
  return { key, value: { stringValue: value } };
}

function otelInt(key: string, value: number): OtelAttribute {
  return { key, value: { intValue: String(value) } };
}

function toUnixNano(epochMs: number): string {
  return `${BigInt(epochMs) * 1_000_000n}`;
}

async function postJson(
  url: string,
  body: string,
  contentType: string,
): Promise<void> {
  if (typeof fetch !== "function") return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_500);
  try {
    const res = await fetch(url, {
      body,
      headers: { "content-type": contentType },
      method: "POST",
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`observability transport failed: ${res.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function parseSentryDsn(dsn: string): { envelopeUrl: string } | undefined {
  try {
    const url = new URL(dsn);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const projectId = pathParts.at(-1);
    if (!projectId) return undefined;

    const basePath = pathParts.slice(0, -1).join("/");
    const pathPrefix = basePath ? `/${basePath}` : "";
    return {
      envelopeUrl: `${url.protocol}//${url.host}${pathPrefix}/api/${projectId}/envelope/`,
    };
  } catch {
    return undefined;
  }
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}
