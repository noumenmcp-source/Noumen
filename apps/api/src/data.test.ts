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

describe("read-API: profiles + events built from ingest", () => {
  beforeEach(() => {
    resetCounters();
    resetConsentOverrides();
    resetTenantRegistry();
  });

  it("ingest builds a profile; read-API returns it for the owner", async () => {
    const app = await buildServer({ logger: false });
    const account = await signup(app);
    const auth = { authorization: `Bearer ${account.apiToken}` };

    const track = await app.inject({
      method: "POST",
      url: "/v1/track",
      payload: {
        writeKey: account.tenant.writeKey,
        events: [
          { type: "identify", anonymousId: "anon_1", traits: { company: "Acme Inc" } },
          { type: "track", anonymousId: "anon_1", event: "Pricing Viewed", properties: { path: "/pricing" } },
        ],
      },
    });
    expect(track.statusCode).toBe(200);
    expect(track.json()).toMatchObject({ stored: 2, suppressed: 0 });

    const profiles = await app.inject({
      method: "GET",
      url: `/v1/tenants/${account.tenant.id}/profiles`,
      headers: auth,
    });
    expect(profiles.statusCode).toBe(200);
    const list = profiles.json().profiles;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ tenantId: account.tenant.id, anonymousId: "anon_1" });
    expect(list[0].firmographics).toMatchObject({ company: "Acme Inc" });

    const events = await app.inject({
      method: "GET",
      url: `/v1/tenants/${account.tenant.id}/events`,
      headers: auth,
    });
    expect(events.statusCode).toBe(200);
    expect(events.json().events).toHaveLength(2);

    await app.close();
  });

  it("read-API rejects missing token (401) and cross-tenant (403)", async () => {
    const app = await buildServer({ logger: false });
    const account = await signup(app);

    const noauth = await app.inject({
      method: "GET",
      url: `/v1/tenants/${account.tenant.id}/profiles`,
    });
    expect(noauth.statusCode).toBe(401);

    const cross = await app.inject({
      method: "GET",
      url: "/v1/tenants/other_tenant/profiles",
      headers: { authorization: `Bearer ${account.apiToken}` },
    });
    expect(cross.statusCode).toBe(403);

    await app.close();
  });
});
