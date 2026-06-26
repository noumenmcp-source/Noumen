import { describe, it, expect } from "vitest";
import { sendCampaign } from "./campaign.js";
import { TemplateGenerator } from "./generators.js";
import { FakeSender } from "./senders.js";
import type { ConsentCheck } from "./types.js";
import { makeProfile } from "./testutils.js";

const canSpam = {
  physicalAddress: "CDP-US Inc, 123 Market St, San Francisco, CA 94105",
  unsubscribeUrl: "https://app.cdp-us.test/unsubscribe",
};

const base = {
  trigger: "welcome" as const,
  from: "hello@cdp-us.test",
  brandName: "CDP-US",
  generator: new TemplateGenerator(),
  canSpam,
};

describe("sendCampaign", () => {
  it("sends to every consented recipient and FakeSender records them", async () => {
    const profiles = [
      makeProfile({ id: "p1", email: "p1@acme.test" }),
      makeProfile({ id: "p2", email: "p2@acme.test" }),
    ];
    const sender = new FakeSender();
    const consentCheck: ConsentCheck = () => true;

    const result = await sendCampaign({
      ...base,
      profiles,
      sender,
      consentCheck,
    });

    expect(result.selected).toBe(2);
    expect(result.sent).toBe(2);
    expect(result.skippedNoConsent).toBe(0);
    expect(sender.count).toBe(2);
    expect(sender.sent.map((m) => m.to)).toEqual([
      "p1@acme.test",
      "p2@acme.test",
    ]);
  });

  it("skips recipients without marketing_email consent and counts them", async () => {
    const consented = makeProfile({ id: "yes", email: "yes@acme.test" });
    const blocked = makeProfile({ id: "no", email: "no@acme.test" });
    const sender = new FakeSender();
    const consentCheck: ConsentCheck = (subject) => subject === "yes@acme.test";

    const result = await sendCampaign({
      ...base,
      profiles: [consented, blocked],
      sender,
      consentCheck,
    });

    expect(result.selected).toBe(2);
    expect(result.sent).toBe(1);
    expect(result.skippedNoConsent).toBe(1);
    expect(sender.count).toBe(1);
    expect(sender.sent[0].to).toBe("yes@acme.test");
  });

  it("sends nothing when no one has consented", async () => {
    const sender = new FakeSender();
    const result = await sendCampaign({
      ...base,
      profiles: [makeProfile({ id: "p1" }), makeProfile({ id: "p2" })],
      sender,
      consentCheck: () => false,
    });
    expect(result.sent).toBe(0);
    expect(result.skippedNoConsent).toBe(2);
    expect(sender.count).toBe(0);
  });

  it("every sent message carries the CAN-SPAM footer", async () => {
    const sender = new FakeSender();
    await sendCampaign({
      ...base,
      profiles: [makeProfile({ id: "p1", email: "p1@acme.test" })],
      sender,
      consentCheck: () => true,
    });
    const msg = sender.sent[0];
    expect(msg.html).toContain(canSpam.physicalAddress);
    expect(msg.html).toContain(canSpam.unsubscribeUrl);
    expect(msg.from).toBe("hello@cdp-us.test");
  });

  it("respects the trigger when selecting recipients", async () => {
    const sender = new FakeSender();
    const profiles = [
      makeProfile({ id: "welcomed", traits: { welcomed: true } }),
      makeProfile({ id: "fresh", email: "fresh@acme.test", traits: {} }),
    ];
    const result = await sendCampaign({
      ...base,
      profiles,
      sender,
      consentCheck: () => true,
    });
    expect(result.selected).toBe(1);
    expect(sender.sent[0].to).toBe("fresh@acme.test");
  });
});
