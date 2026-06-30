import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerHealth } from "./routes/health.js";

describe("health/liveness/readiness routes", () => {
  it("liveness is always 200", async () => {
    const app = Fastify();
    registerHealth(app);
    const res = await app.inject({ method: "GET", url: "/v1/live" });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("readiness returns 200 when the probe is healthy (or absent)", async () => {
    const app = Fastify();
    registerHealth(app, { readiness: async () => ({ ok: true, checks: { database: "ok" } }) });
    const res = await app.inject({ method: "GET", url: "/v1/ready" });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ready", checks: { database: "ok" } });

    const noProbe = Fastify();
    registerHealth(noProbe);
    const r2 = await noProbe.inject({ method: "GET", url: "/v1/ready" });
    await noProbe.close();
    expect(r2.statusCode).toBe(200);
  });

  it("readiness returns 503 when a dependency is down", async () => {
    const app = Fastify();
    registerHealth(app, { readiness: async () => ({ ok: false, checks: { database: "fail" } }) });
    const res = await app.inject({ method: "GET", url: "/v1/ready" });
    await app.close();
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: "unready", checks: { database: "fail" } });
  });
});
