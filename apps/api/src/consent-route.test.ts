import { beforeEach, describe, expect, it } from "vitest";
import { isAllowed, resetConsentOverrides } from "./consent.js";
import { resetCounters } from "./routes/health.js";
import { buildServer } from "./server.js";
import { resetTenantRegistry } from "./tenant.js";

describe("POST /v1/consent (public CMP)", () => {
  beforeEach(() => {
    resetCounters();
    resetConsentOverrides();
    resetTenantRegistry();
  });

  it("records resolved consent; gates honor it", async () => {
    const app = await buildServer({ logger: false });
    const res = await app.inject({
      method: "POST",
      url: "/v1/consent",
      payload: {
        writeKey: "wk_demo_us",
        subject: "anon_1",
        bannerChoice: { marketingEmailOptIn: true, saleOrShareOptOut: true },
        gpc: false,
      },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().state).toMatchObject({
      analytics: true,
      marketing_email: true,
      sale_or_share: false,
    });
    expect(isAllowed("demo", "anon_1", "marketing_email")).toBe(true);
    expect(isAllowed("demo", "anon_1", "sale_or_share")).toBe(false);
  });

  it("GPC forces sale_or_share off regardless of banner", async () => {
    const app = await buildServer({ logger: false });
    const res = await app.inject({
      method: "POST",
      url: "/v1/consent",
      payload: {
        writeKey: "wk_demo_us",
        subject: "anon_gpc",
        bannerChoice: { saleOrShareOptOut: false },
        gpc: true,
      },
    });
    await app.close();

    expect(res.json().state).toMatchObject({ sale_or_share: false, gpc: true });
    expect(isAllowed("demo", "anon_gpc", "sale_or_share")).toBe(false);
  });

  it("rejects an unknown write key", async () => {
    const app = await buildServer({ logger: false });
    const res = await app.inject({
      method: "POST",
      url: "/v1/consent",
      payload: { writeKey: "nope", subject: "x" },
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });
});
