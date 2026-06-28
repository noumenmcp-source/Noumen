import { createHmac, timingSafeEqual } from "node:crypto";
import type { IngestEvent } from "@cdp-us/contracts";

/** @example const headers: WebhookHeaders = { "stripe-signature": "t=1,v1=abc" }; */
export type WebhookHeaders = Readonly<Record<string, string | undefined>>;

/** @example const verifier: WebhookVerifier = (raw, headers, secret) => verifyGithub(raw, headers["x-hub-signature-256"], secret); */
export type WebhookVerifier = (rawBody: string, headers: WebhookHeaders, secret: string) => boolean;

/** @example const mapper: WebhookMapper = (payload, headers) => []; */
export type WebhookMapper = (payload: unknown, headers: WebhookHeaders) => readonly IngestEvent[];

/** @example const config: InboundProvider = { provider: "github", verify: () => true, map: () => [] }; */
export type InboundProvider = Readonly<{ provider: string; verify: WebhookVerifier; map: WebhookMapper }>;

/** @example const result: InboundResult = { verified: true, events: [] }; */
export type InboundResult = Readonly<{ verified: boolean; events: readonly IngestEvent[] }>;

/** @example const ok = verifyHmacSha256("{}", "sha256=abc", "secret"); */
export function verifyHmacSha256(rawBody: string, signature: string | undefined, secret: string): boolean {
  const expected = hmacHex(`${rawBody}`, secret);
  const actual = signature?.replace(/^sha256=/, "").trim() ?? "";
  return timingSafeHexEqual(expected, actual);
}

/** @example const ok = verifyStripe("{}", "t=1,v1=abc", "secret"); */
export function verifyStripe(rawBody: string, header: string | undefined, secret: string): boolean {
  const parts = Object.fromEntries((header ?? "").split(",").map((part) => part.split("=")));
  if (!parts.t || !parts.v1) return false;
  return timingSafeHexEqual(hmacHex(`${parts.t}.${rawBody}`, secret), parts.v1);
}

/** @example const ok = verifyGithub("{}", "sha256=abc", "secret"); */
export function verifyGithub(rawBody: string, header: string | undefined, secret: string): boolean {
  return verifyHmacSha256(rawBody, header, secret);
}

/** @example const registry = new InboundRegistry([{ provider: "generic", verify: () => true, map: () => [] }]); */
export class InboundRegistry {
  private readonly providers = new Map<string, InboundProvider>();

  constructor(providers: readonly InboundProvider[] = []) {
    for (const provider of providers) this.register(provider);
  }

  /** @example registry.register({ provider: "generic", verify: () => true, map: () => [] }); */
  register(provider: InboundProvider): void {
    this.providers.set(provider.provider, provider);
  }

  /** @example const result = registry.handle("generic", "{}", {}, "secret"); */
  handle(providerKey: string, rawBody: string, headers: WebhookHeaders, secret: string): InboundResult {
    const provider = this.providers.get(providerKey);
    if (!provider || !provider.verify(rawBody, headers, secret)) return { verified: false, events: [] };
    return { verified: true, events: provider.map(parsePayload(rawBody), headers) };
  }
}

function hmacHex(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function timingSafeHexEqual(expectedHex: string, actualHex: string): boolean {
  if (!/^[a-f0-9]+$/i.test(actualHex) || expectedHex.length !== actualHex.length) return false;
  return timingSafeEqual(Buffer.from(expectedHex, "hex"), Buffer.from(actualHex, "hex"));
}

function parsePayload(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }
}
