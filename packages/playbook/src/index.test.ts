import { describe, expect, it } from "vitest";
import type { LifecycleStage } from "@cdp-us/computed-traits";
import { generatePlaybook } from "./index.js";

function stages(partial: Partial<Record<LifecycleStage, number>>): Record<LifecycleStage, number> {
  return { new: 0, active: 0, dormant: 0, lost: 0, vip: 0, junk: 0, ...partial };
}

describe("generatePlaybook", () => {
  it("emits actions only for non-empty stages, ranked by impact", () => {
    const actions = generatePlaybook({ stages: stages({ dormant: 417, junk: 1240, vip: 312, new: 96, lost: 0 }) });
    // dormant impact 417*1=417 > vip 312*0.9=281 > new 96*0.6=58 > junk 1240*0.3=372... reorder:
    // 417(win_back) , 372(exclude_junk), 281(resell), 58(chase). lost dropped (0).
    expect(actions.map((a) => a.kind)).toEqual(["win_back", "exclude_junk", "resell", "chase_leads"]);
    expect(actions[0]).toMatchObject({ kind: "win_back", stage: "dormant", channel: "email", audienceSize: 417, impact: 417 });
    expect(actions.some((a) => a.stage === "lost")).toBe(false);
  });

  it("maps each move to the deck's channel", () => {
    const byKind = Object.fromEntries(
      generatePlaybook({ stages: stages({ dormant: 1, vip: 1, new: 1, lost: 1, junk: 1 }) }).map((a) => [a.kind, a.channel]),
    );
    expect(byKind).toMatchObject({
      win_back: "email",
      resell: "sms",
      chase_leads: "task",
      reactivate: "email",
      exclude_junk: "ad_audience",
    });
  });

  it("returns nothing for an empty base", () => {
    expect(generatePlaybook({ stages: stages({}) })).toEqual([]);
  });

  it("honors the limit", () => {
    const actions = generatePlaybook({ stages: stages({ dormant: 5, vip: 5, new: 5, lost: 5, junk: 5 }), limit: 2 });
    expect(actions).toHaveLength(2);
  });
});
