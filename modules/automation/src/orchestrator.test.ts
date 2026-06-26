import { describe, it, expect } from "vitest";
import {
  InMemoryMessengerAdapter,
  InMemorySocialAdapter,
} from "./adapters.js";
import {
  Orchestrator,
  TCPA_PURPOSE,
  type AutomationContext,
  type ConsentCheck,
  type Step,
} from "./orchestrator.js";
import { automationManifest } from "./manifest.js";

/** Build a fresh context; `consent` decides the TCPA gate deterministically. */
function makeCtx(consent: boolean | ConsentCheck = false): {
  ctx: AutomationContext;
  social: InMemorySocialAdapter;
  messenger: InMemoryMessengerAdapter;
} {
  const social = new InMemorySocialAdapter();
  const messenger = new InMemoryMessengerAdapter();
  const consentCheck: ConsentCheck =
    typeof consent === "function" ? consent : () => consent;
  return { ctx: { social, messenger, consentCheck }, social, messenger };
}

describe("Orchestrator.runScenario", () => {
  it("returns one result per step, preserving order and indices", async () => {
    const { ctx } = makeCtx(true);
    const steps: Step[] = [
      { kind: "social_post", content: "hello" },
      { kind: "wait", ms: 100 },
      { kind: "messenger_send", to: "+15551230000", content: "hi" },
    ];

    const results = await new Orchestrator().runScenario(steps, ctx);

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(results.map((r) => r.kind)).toEqual([
      "social_post",
      "wait",
      "messenger_send",
    ]);
  });

  it("social_post succeeds and is captured by the adapter", async () => {
    const { ctx, social } = makeCtx();
    const results = await new Orchestrator().runScenario(
      [{ kind: "social_post", content: "launch day" }],
      ctx,
    );

    expect(results[0]).toMatchObject({
      index: 0,
      kind: "social_post",
      status: "posted",
      id: "social_1",
    });
    expect(social.posts).toEqual([{ id: "social_1", content: "launch day" }]);
  });

  it("wait is a deterministic no-op", async () => {
    const { ctx, social, messenger } = makeCtx();
    const results = await new Orchestrator().runScenario(
      [{ kind: "wait" }],
      ctx,
    );

    expect(results[0]).toMatchObject({ status: "waited", kind: "wait" });
    expect(results[0].id).toBeUndefined();
    expect(social.posts).toHaveLength(0);
    expect(messenger.sent).toHaveLength(0);
  });

  it("TCPA gate: marketing messenger_send is SKIPPED when consent is false", async () => {
    const { ctx, messenger } = makeCtx(false);
    const results = await new Orchestrator().runScenario(
      [
        {
          kind: "messenger_send",
          to: "+15551230001",
          content: "Sale ends tonight!",
          marketing: true,
        },
      ],
      ctx,
    );

    expect(results[0]).toMatchObject({
      kind: "messenger_send",
      status: "skipped",
      reason: "tcpa_consent_missing",
    });
    expect(results[0].id).toBeUndefined();
    // Nothing was delivered.
    expect(messenger.sent).toHaveLength(0);
  });

  it("TCPA gate: marketing messenger_send is SENT when consent is true", async () => {
    const { ctx, messenger } = makeCtx(true);
    const results = await new Orchestrator().runScenario(
      [
        {
          kind: "messenger_send",
          to: "+15551230002",
          content: "Sale ends tonight!",
          marketing: true,
        },
      ],
      ctx,
    );

    expect(results[0]).toMatchObject({
      kind: "messenger_send",
      status: "sent",
      id: "msg_1",
    });
    expect(messenger.sent).toEqual([
      { id: "msg_1", to: "+15551230002", content: "Sale ends tonight!" },
    ]);
  });

  it("checks the messaging_tcpa purpose for the recipient", async () => {
    const seen: Array<{ to: string; purpose: string }> = [];
    const consentCheck: ConsentCheck = (to, purpose) => {
      seen.push({ to, purpose });
      return true;
    };
    const { ctx } = makeCtx(consentCheck);

    await new Orchestrator().runScenario(
      [
        {
          kind: "messenger_send",
          to: "+15551230003",
          content: "promo",
          marketing: true,
        },
      ],
      ctx,
    );

    expect(seen).toEqual([
      { to: "+15551230003", purpose: TCPA_PURPOSE },
    ]);
    expect(TCPA_PURPOSE).toBe("messaging_tcpa");
  });

  it("non-marketing (transactional) messenger_send is NOT gated and is sent", async () => {
    const { ctx, messenger } = makeCtx(false); // consent false, but transactional
    const results = await new Orchestrator().runScenario(
      [
        {
          kind: "messenger_send",
          to: "+15551230004",
          content: "Your order shipped.",
        },
      ],
      ctx,
    );

    expect(results[0]).toMatchObject({ status: "sent", id: "msg_1" });
    expect(messenger.sent).toHaveLength(1);
  });

  it("marketing send is skipped when no consentCheck is provided", async () => {
    const social = new InMemorySocialAdapter();
    const messenger = new InMemoryMessengerAdapter();
    const ctx: AutomationContext = { social, messenger }; // no consentCheck

    const results = await new Orchestrator().runScenario(
      [
        {
          kind: "messenger_send",
          to: "+15551230005",
          content: "promo",
          marketing: true,
        },
      ],
      ctx,
    );

    expect(results[0]).toMatchObject({
      status: "skipped",
      reason: "tcpa_consent_missing",
    });
    expect(messenger.sent).toHaveLength(0);
  });

  it("runs a mixed scenario end-to-end via fakes", async () => {
    // Consent granted only for one recipient.
    const consentCheck: ConsentCheck = (to) => to === "+1555ALLOW";
    const { ctx, social, messenger } = makeCtx(consentCheck);

    const steps: Step[] = [
      { kind: "social_post", content: "New blog post is live" },
      { kind: "wait", ms: 5 },
      {
        kind: "messenger_send",
        to: "+1555DENY",
        content: "promo",
        marketing: true,
      },
      {
        kind: "messenger_send",
        to: "+1555ALLOW",
        content: "promo",
        marketing: true,
      },
      {
        kind: "messenger_send",
        to: "+1555TXN",
        content: "receipt",
      },
    ];

    const results = await new Orchestrator().runScenario(steps, ctx);

    expect(results.map((r) => r.status)).toEqual([
      "posted",
      "waited",
      "skipped",
      "sent",
      "sent",
    ]);
    expect(social.posts).toHaveLength(1);
    // Only the consented marketing send + the transactional send were delivered.
    expect(messenger.sent.map((m) => m.to)).toEqual(["+1555ALLOW", "+1555TXN"]);
  });
});

describe("automationManifest", () => {
  it("declares the automation key and TCPA consent requirement", () => {
    expect(automationManifest.key).toBe("automation");
    expect(automationManifest.requiresConsent).toContain("messaging_tcpa");
  });
});
