import type { Profile } from "@cdp-us/contracts";
import { describe, expect, it } from "vitest";
import { accountKeyFor, accountOf, buildAccountGraph, members } from "./index.js";

describe("identity graph", () => {
  it("groups corporate domains and ignores free mail", () => {
    expect(accountKeyFor(profile("p4", "person@gmail.com"))).toBeNull();
    expect(buildAccountGraph(profiles()).accounts).toHaveLength(1);
    expect(members(buildAccountGraph(profiles()), "acme.com")).toEqual(["p1", "p2"]);
  });

  it("resolves company conflicts deterministically", () => {
    const account = buildAccountGraph(profiles()).accounts[0];
    expect(account.company).toBe("Acme Corp");
    expect(account.primaryProfileId).toBe("p1");
  });

  it("supports accountOf and unknown lookups", () => {
    const graph = buildAccountGraph(profiles());
    expect(accountOf(graph, "p2")?.key).toBe("acme.com");
    expect(accountOf(graph, "missing")).toBeNull();
    expect(members(graph, "missing")).toEqual([]);
  });
});

function profiles(): readonly Profile[] {
  return [profile("p2", "bob@acme.com", "Acme"), profile("p1", "ada@acme.com", "Acme Corp"), profile("p3", "x@gmail.com")];
}

function profile(id: string, email: string, company?: string): Profile {
  return { id, tenantId: "t", email, firmographics: { company }, intent: {}, traits: {}, createdAt: id === "p1" ? "2026-01-01T00:00:00.000Z" : "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z" };
}
