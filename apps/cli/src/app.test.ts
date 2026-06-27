import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "./app.js";
import type { HttpRequest, HttpTransport, Output } from "./types.js";

describe("cdp CLI", () => {
  it("signs up with the expected HTTP request and JSON output", async () => {
    const fake = fakeTransport({ ok: true, apiToken: "tok", tenant: { writeKey: "wk" } });
    const out = capture();

    const code = await runCli({
      argv: ["--json", "signup", "--company", "Acme", "--email", "owner@example.com"],
      transport: fake.transport,
      output: out,
    });

    expect(code).toBe(0);
    expect(fake.requests[0]).toMatchObject({
      method: "POST",
      url: "http://localhost:8110/v1/signup",
      body: { companyName: "Acme", ownerEmail: "owner@example.com" },
    });
    expect(JSON.parse(out.stdout[0] ?? "{}")).toMatchObject({ ok: true });
  });

  it("round-trips login config in a temp directory", async () => {
    const configDir = await mkdtemp(join(tmpdir(), "cdp-cli-"));
    const out = capture();

    const code = await runCli({
      argv: ["login", "--token", "tok", "--tenant", "tenant_1", "--write-key", "wk_1"],
      configDir,
      output: out,
    });

    expect(code).toBe(0);
    const raw = await readFile(join(configDir, "config.json"), "utf8");
    expect(JSON.parse(raw)).toMatchObject({ token: "tok", tenantId: "tenant_1", writeKey: "wk_1" });
  });

  it("lists and enables modules with bearer auth", async () => {
    const configDir = await loginTemp();
    const fake = fakeTransport({ ok: true });

    await runCli({ argv: ["modules"], configDir, transport: fake.transport, output: capture() });
    await runCli({ argv: ["modules", "enable", "email"], configDir, transport: fake.transport, output: capture() });

    expect(fake.requests[0]?.url).toBe("http://localhost:8110/v1/modules");
    expect(fake.requests[1]).toMatchObject({
      method: "POST",
      url: "http://localhost:8110/v1/tenants/tenant_1/modules/email",
      headers: expect.objectContaining({ authorization: "Bearer tok" }),
    });
  });

  it("sends track and identify events to /v1/track", async () => {
    const configDir = await loginTemp();
    const fake = fakeTransport({ accepted: true });

    await runCli({
      argv: ["track", "anon_1", "Signed Up", "--prop", "plan=starter"],
      configDir,
      transport: fake.transport,
      output: capture(),
    });
    await runCli({
      argv: ["identify", "anon_1", "--trait", "email=owner@example.com"],
      configDir,
      transport: fake.transport,
      output: capture(),
    });

    expect(fake.requests[0]?.body).toMatchObject({
      writeKey: "wk_1",
      events: [{ type: "track", event: "Signed Up", properties: { plan: "starter" } }],
    });
    expect(fake.requests[1]?.body).toMatchObject({
      events: [{ type: "identify", traits: { email: "owner@example.com" } }],
    });
  });

  it("reads profiles, events, and health", async () => {
    const configDir = await loginTemp();
    const fake = fakeTransport({ ok: true });

    await runCli({ argv: ["profiles"], configDir, transport: fake.transport, output: capture() });
    await runCli({ argv: ["events", "--anon", "anon_1"], configDir, transport: fake.transport, output: capture() });
    await runCli({ argv: ["health"], configDir, transport: fake.transport, output: capture() });

    expect(fake.requests.map((request) => request.url)).toEqual([
      "http://localhost:8110/v1/tenants/tenant_1/profiles",
      "http://localhost:8110/v1/tenants/tenant_1/events?anonymousId=anon_1",
      "http://localhost:8110/v1/health",
    ]);
  });

  it("returns a non-zero code for API errors", async () => {
    const fake = fakeTransport({ message: "nope" }, 403);
    const out = capture();

    const code = await runCli({ argv: ["health"], transport: fake.transport, output: out });

    expect(code).toBe(1);
    expect(out.stderr[0]).toContain("403");
  });
});

function fakeTransport(body: unknown, status = 200) {
  const requests: HttpRequest[] = [];
  const transport = vi.fn<HttpTransport>(async (request) => {
    requests.push(request);
    return { status, body };
  });
  return { requests, transport };
}

function capture(): Output & Readonly<{ stdout: string[]; stderr: string[] }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, write: (message) => stdout.push(message), error: (message) => stderr.push(message) };
}

async function loginTemp(): Promise<string> {
  const configDir = await mkdtemp(join(tmpdir(), "cdp-cli-"));
  await runCli({
    argv: ["login", "--token", "tok", "--tenant", "tenant_1", "--write-key", "wk_1"],
    configDir,
    output: capture(),
  });
  return configDir;
}
