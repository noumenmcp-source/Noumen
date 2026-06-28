import { beforeEach, describe, expect, it } from "vitest";
import { resetConsentOverrides } from "./consent.js";
import { resetCounters } from "./routes/health.js";
import { buildServer } from "./server.js";
import { resetTenantRegistry } from "./tenant.js";

type App = Awaited<ReturnType<typeof buildServer>>;

async function signup(app: App) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/signup",
    payload: { companyName: "Acme US", ownerEmail: "owner@acme.example" },
  });
  return res.json();
}

describe("D1: segment query", () => {
  beforeEach(() => {
    resetCounters();
    resetConsentOverrides();
    resetTenantRegistry();
  });

  it("returns profiles matching a firmographic rule (auth, own-tenant)", async () => {
    const app = await buildServer({ logger: false });
    const account = await signup(app);
    await app.inject({
      method: "POST",
      url: "/v1/track",
      payload: {
        writeKey: account.tenant.writeKey,
        events: [
          {
            type: "identify",
            anonymousId: "a1",
            userId: "u1",
            traits: { company: "Acme" },
          },
        ],
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/tenants/${account.tenant.id}/segments/query`,
      headers: { authorization: `Bearer ${account.apiToken}` },
      payload: { rule: [{ path: "firmographics.company", equals: "Acme" }] },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBe(1);
    expect(res.json().members[0].firmographics.company).toBe("Acme");
  });

  it("rejects a non-array rule with 400", async () => {
    const app = await buildServer({ logger: false });
    const account = await signup(app);
    const res = await app.inject({
      method: "POST",
      url: `/v1/tenants/${account.tenant.id}/segments/query`,
      headers: { authorization: `Bearer ${account.apiToken}` },
      payload: { rule: "nope" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("E: consent capture + signed history", () => {
  beforeEach(() => {
    resetCounters();
    resetConsentOverrides();
    resetTenantRegistry();
  });

  it("an analytics opt-out suppresses subsequent ingest for that subject", async () => {
    const app = await buildServer({ logger: false });
    const account = await signup(app);

    const consent = await app.inject({
      method: "POST",
      url: "/v1/consent",
      payload: {
        writeKey: account.tenant.writeKey,
        subject: "anonX",
        bannerChoice: { analyticsOptOut: true },
      },
    });
    expect(consent.statusCode).toBe(200);
    expect(consent.json().state.analytics).toBe(false);

    const track = await app.inject({
      method: "POST",
      url: "/v1/track",
      payload: {
        writeKey: account.tenant.writeKey,
        events: [{ type: "track", anonymousId: "anonX", event: "Page Viewed" }],
      },
    });
    await app.close();

    expect(track.statusCode).toBe(200);
    expect(track.json()).toMatchObject({ stored: 0, suppressed: 1 });
  });

  it("GPC forces sale_or_share off and the chain verifies", async () => {
    const app = await buildServer({ logger: false });
    const account = await signup(app);

    await app.inject({
      method: "POST",
      url: "/v1/consent",
      payload: { writeKey: account.tenant.writeKey, subject: "anonY", gpc: true },
    });

    const read = await app.inject({
      method: "GET",
      url: `/v1/tenants/${account.tenant.id}/consent/anonY`,
      headers: { authorization: `Bearer ${account.apiToken}` },
    });
    await app.close();

    expect(read.statusCode).toBe(200);
    expect(read.json().state).toMatchObject({ sale_or_share: false, gpc: true });
    expect(read.json().verified).toBe(true);
    expect(read.json().records).toHaveLength(1);
  });
});
