import { beforeEach, describe, expect, it } from "vitest";
import { resetConsentOverrides } from "./consent.js";
import { resetCounters } from "./routes/health.js";
import { buildServer } from "./server.js";
import { resetTenantRegistry } from "./tenant.js";

describe("public API rate limiting", () => {
  beforeEach(() => {
    resetCounters();
    resetConsentOverrides();
    resetTenantRegistry();
  });

  it("returns 429 once the configured limit is exceeded", async () => {
    const app = await buildServer({
      logger: false,
      rateLimit: { max: 2, timeWindow: "1 minute" },
    });
    const hit = () => app.inject({ method: "GET", url: "/v1/health" });

    const first = await hit();
    const second = await hit();
    const third = await hit();
    await app.close();

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(third.statusCode).toBe(429);
  });

  it("does not rate limit when disabled", async () => {
    const app = await buildServer({ logger: false, rateLimit: false });
    let last = 0;
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: "GET", url: "/v1/health" });
      last = res.statusCode;
    }
    await app.close();

    expect(last).toBe(200);
  });
});
