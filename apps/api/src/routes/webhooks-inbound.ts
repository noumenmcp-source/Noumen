import { Readable } from "node:stream";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Tenant } from "@cdp-us/contracts";
import type { ProfileService } from "@cdp-us/core-cdp";
import { InboundRegistry, type WebhookHeaders } from "@cdp-us/webhooks-inbound";
import type { TenantStore } from "../tenant.js";

export type WebhooksInboundDeps = Readonly<{
  registry: InboundRegistry;
  resolveSecret(tenant: Tenant, provider: string): string | undefined;
}>;

const rawBodies = new WeakMap<FastifyRequest, string>();

/** @example registerWebhooksInbound(app, tenantStore, profileService, deps); // POST /v1/tenants/t_1/webhooks/stripe */
export function registerWebhooksInbound(app: FastifyInstance, tenantStore: TenantStore, profileService: Pick<ProfileService, "applyEvent">, deps: WebhooksInboundDeps): void {
  app.post("/v1/tenants/:tenantId/webhooks/:provider", { preParsing: captureRawBody }, async (req, reply) => {
    const { tenantId, provider } = req.params as { tenantId: string; provider: string };
    const tenant = await tenantStore.getTenant(tenantId);
    if (!tenant) return reply.code(404).send({ error: "unknown_tenant" });
    const secret = deps.resolveSecret(tenant, provider);
    if (!secret) return reply.code(404).send({ error: "unknown_provider", provider });
    const rawBody = rawBodies.get(req) ?? "";
    if (!rawBody) return reply.code(400).send({ error: "invalid_body" });
    const result = deps.registry.handle(provider, rawBody, headerMap(req), secret);
    if (!result.verified) return reply.code(401).send({ error: "unverified" });
    try {
      for (const event of result.events) await profileService.applyEvent(tenantId, event);
      return reply.send({ ok: true, tenantId, provider, accepted: result.events.length });
    } catch {
      return reply.code(502).send({ error: "ingest_failed" });
    }
  });
}

async function captureRawBody(req: FastifyRequest, _reply: unknown, payload: AsyncIterable<Buffer | string>): Promise<Readable> {
  const chunks: Buffer[] = [];
  for await (const chunk of payload) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  rawBodies.set(req, raw);
  return Readable.from([raw]);
}

function headerMap(req: FastifyRequest): WebhookHeaders {
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    headers[key] = Array.isArray(value) ? value.join(",") : value === undefined ? undefined : String(value);
  }
  return headers;
}
