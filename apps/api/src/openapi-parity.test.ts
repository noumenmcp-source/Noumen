import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { resetConsentOverrides } from "./consent.js";
import { resetCounters } from "./routes/health.js";
import { buildServer } from "./server.js";
import { resetTenantRegistry } from "./tenant.js";

const here = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(
  readFileSync(join(here, "..", "openapi.json"), "utf-8"),
) as { paths: Record<string, Record<string, unknown>> };

/** Fill OpenAPI path templates with a placeholder so the route still matches. */
function concretePath(template: string): string {
  return template.replace(/\{[^}]+\}/g, "x");
}

describe("OpenAPI spec ⇄ live routes parity", () => {
  beforeEach(() => {
    resetCounters();
    resetConsentOverrides();
    resetTenantRegistry();
  });

  it("every documented path+method resolves to a real route (no 404)", async () => {
    const app = await buildServer({ logger: false, rateLimit: false });
    const missing: string[] = [];

    for (const [template, methods] of Object.entries(spec.paths)) {
      for (const method of Object.keys(methods)) {
        const res = await app.inject({
          method: method.toUpperCase() as "GET",
          url: concretePath(template),
          payload: method === "get" ? undefined : {},
        });
        // A registered route never yields 404; auth/validation/billing codes do.
        if (res.statusCode === 404) {
          missing.push(`${method.toUpperCase()} ${template}`);
        }
      }
    }

    await app.close();
    expect(missing, `documented but unrouted: ${missing.join(", ")}`).toEqual([]);
  });

  it("serves the spec at GET /v1/openapi.json", async () => {
    const app = await buildServer({ logger: false, rateLimit: false });
    const res = await app.inject({ method: "GET", url: "/v1/openapi.json" });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.json().openapi).toMatch(/^3\./);
  });

  it("documents exactly 15 operations across 15 paths", () => {
    const paths = Object.keys(spec.paths);
    const ops = paths.reduce((n, p) => n + Object.keys(spec.paths[p]!).length, 0);
    expect(paths).toHaveLength(15);
    expect(ops).toBe(15);
  });
});
