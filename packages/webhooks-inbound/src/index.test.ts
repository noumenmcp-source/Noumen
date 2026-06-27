import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InboundRegistry, verifyGithub, verifyHmacSha256, verifyStripe, type WebhookMapper } from "./index.js";

const raw = JSON.stringify({ type: "customer.created", id: "cus_1" });

describe("webhooks inbound", () => {
  it("verifies generic, Stripe, and GitHub signatures", () => {
    expect(verifyHmacSha256(raw, `sha256=${hmac(raw, "secret")}`, "secret")).toBe(true);
    expect(verifyHmacSha256(raw, "sha256=bad", "secret")).toBe(false);
    expect(verifyGithub(raw, `sha256=${hmac(raw, "secret")}`, "secret")).toBe(true);
    expect(verifyStripe(raw, `t=123,v1=${hmac(`123.${raw}`, "secret")}`, "secret")).toBe(true);
  });

  it("does not map unverified payloads", () => {
    let mapped = false;
    const registry = new InboundRegistry([{ provider: "generic", verify: () => false, map: () => { mapped = true; return []; } }]);

    expect(registry.handle("generic", raw, {}, "secret")).toEqual({ verified: false, events: [] });
    expect(mapped).toBe(false);
  });

  it("maps verified payloads and returns empty for unknown provider payloads", () => {
    const mapper: WebhookMapper = (payload) => isRecord(payload) && payload.type === "customer.created"
      ? [{ type: "track", anonymousId: String(payload.id), event: "Webhook Received", properties: { provider: "stripe" } }]
      : [];
    const registry = new InboundRegistry([{ provider: "stripe", verify: () => true, map: mapper }]);

    expect(registry.handle("stripe", raw, {}, "secret")).toEqual({
      verified: true,
      events: [{ type: "track", anonymousId: "cus_1", event: "Webhook Received", properties: { provider: "stripe" } }],
    });
    expect(registry.handle("stripe", JSON.stringify({ type: "unknown" }), {}, "secret").events).toEqual([]);
  });
});

function hmac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
