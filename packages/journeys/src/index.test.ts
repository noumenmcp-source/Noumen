import type { Profile } from "@cdp-us/contracts";
import { describe, expect, it, vi } from "vitest";
import { runJourney, type JourneyContext, type JourneyDefinition } from "./index.js";

describe("journeys", () => {
  it("runs linear journeys and invokes injected executors", async () => {
    const exec = vi.fn().mockResolvedValue({ status: "queued" });
    const run = await runJourney(linearJourney(), context(80), { email: exec });

    expect(run.status).toBe("completed");
    expect(run.results.map((result) => result.status)).toEqual(["entered", "waited", "acted", "exited"]);
    expect(exec).toHaveBeenCalledWith({ template: "welcome" }, context(80));
  });

  it("branches by context predicates and remains deterministic", async () => {
    const def: JourneyDefinition = {
      key: "branching",
      steps: [
        { key: "enter", type: "enter", when: () => true },
        { key: "branch", type: "branch", when: (ctx) => (ctx.profile.intent.score ?? 0) > 50, trueStep: "hot", falseStep: "cold" },
        { key: "hot", type: "action", executor: "destination", params: { segment: "hot" }, next: "exit" },
        { key: "cold", type: "action", executor: "destination", params: { segment: "cold" }, next: "exit" },
        { key: "exit", type: "exit" },
      ],
    };
    const executors = { destination: () => ({ status: "synced" }) };

    expect(await runJourney(def, context(90), executors)).toEqual(await runJourney(def, context(90), executors));
    expect((await runJourney(def, context(90), executors)).results.map((result) => result.key)).toEqual(["enter", "branch", "hot", "exit"]);
  });

  it("halts loops at the configured step limit", async () => {
    const def: JourneyDefinition = {
      key: "loop",
      steps: [{ key: "wait", type: "wait", delaySeconds: 60, next: "wait" }],
    };

    const run = await runJourney(def, context(10), {}, { maxSteps: 3 });

    expect(run.status).toBe("halted");
    expect(run.results).toHaveLength(3);
  });
});

function linearJourney(): JourneyDefinition {
  return {
    key: "welcome",
    steps: [
      { key: "enter", type: "enter", when: () => true },
      { key: "wait", type: "wait", delaySeconds: 60 },
      { key: "send", type: "action", executor: "email", params: { template: "welcome" } },
      { key: "exit", type: "exit" },
    ],
  };
}

function context(score: number): JourneyContext {
  return { profile: { ...profile(), intent: { score } }, events: [] };
}

function profile(): Profile {
  return {
    id: "profile_1",
    tenantId: "tenant_1",
    anonymousId: "anon_1",
    email: "buyer@example.com",
    firmographics: {},
    intent: {},
    traits: {},
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
}
