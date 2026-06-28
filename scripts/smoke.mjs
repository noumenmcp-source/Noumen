#!/usr/bin/env node
// Live end-to-end smoke against a running CDP-US API.
// Usage: BASE=http://127.0.0.1:8110 node scripts/smoke.mjs
// Exits non-zero on the first failed assertion. No dependencies.

const BASE = process.env.BASE ?? "http://127.0.0.1:8110";

async function call(path, { method = "GET", token, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

const health = await call("/v1/health");
assert(health.status === 200 && health.json.status === "ok", "health is ok");

const spec = await call("/v1/openapi.json");
assert(spec.status === 200 && Object.keys(spec.json.paths).length >= 14, "openapi served");

const signup = await call("/v1/signup", {
  method: "POST",
  body: { companyName: "Smoke Co", ownerEmail: "smoke@example.com" },
});
assert(signup.status === 201 && signup.json.apiToken, "signup returns a token");
const { id: tenantId, writeKey } = signup.json.tenant;
const token = signup.json.apiToken;

const track = await call("/v1/track", {
  method: "POST",
  body: {
    writeKey,
    events: [
      {
        type: "identify",
        anonymousId: "a1",
        userId: "u1",
        traits: { company: "Acme", email: "buyer@acme.example" },
      },
    ],
  },
});
assert(track.status === 200 && track.json.stored === 1, "ingest stored the event (billing gate passed)");

const seg = await call(`/v1/tenants/${tenantId}/segments/query`, {
  method: "POST",
  token,
  body: { rule: [{ path: "firmographics.company", equals: "Acme" }] },
});
assert(seg.status === 200 && seg.json.count === 1, "segment query found the profile");
assert(seg.json.members[0].email === "buyer@acme.example", "email was lifted onto the profile");
assert(seg.json.members[0].intent.score > 0, "intent score accumulated");

const exp = await call(`/v1/tenants/${tenantId}/export`, { token });
assert(exp.status === 200, "export endpoint responds");

console.log("\nAll smoke checks passed.");
