import { describe, expect, it, vi } from "vitest";
import { createIpinfoProvider } from "./ipinfo.js";

const cannedFetch = () =>
  vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ org: "AS15169 Google LLC", country: "US", hostname: "dns.google" }),
  }) as unknown as typeof fetch;

describe("createIpinfoProvider", () => {
  it("maps org→company and country for an IP key", async () => {
    const provider = createIpinfoProvider({ fetchImpl: cannedFetch(), token: "test-token" });
    const result = await provider.lookup({ type: "ip", value: "8.8.8.8" });
    expect(result).toEqual({ company: "Google LLC", country: "US" });
  });

  it("returns null for a non-IP key", async () => {
    const provider = createIpinfoProvider({ fetchImpl: cannedFetch(), token: "test-token" });
    expect(await provider.lookup({ type: "domain", value: "example.com" })).toBeNull();
  });

  it("returns null when no token is configured", async () => {
    vi.stubEnv("IPINFO_TOKEN", "");
    const provider = createIpinfoProvider({ fetchImpl: cannedFetch() });
    expect(await provider.lookup({ type: "ip", value: "8.8.8.8" })).toBeNull();
    vi.unstubAllEnvs();
  });
});
