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
    expect(actions[0]).toMatchObject({
      kind: "win_back",
      stage: "dormant",
      channel: "email",
      audienceSize: 417,
      impact: 417,
      category: 'action',
      confidence: 'high',
      expectedEffect: "Recover 15% of dormant customers' lifetime value with targeted offers."
    });
    expect(actions.some((a) => a.stage === "lost")).toBe(false);
  });

  it("maps each move to the deck's channel and includes new fields", () => {
    const byKind = Object.fromEntries(
      generatePlaybook({ stages: stages({ dormant: 1, vip: 1, new: 1, lost: 1, junk: 1 }) }).map((a) => [
        a.kind,
        { channel: a.channel, category: a.category, confidence: a.confidence, expectedEffect: a.expectedEffect }
      ]),
    );
    expect(byKind).toMatchObject({
      win_back: {
        channel: "email",
        category: 'action',
        confidence: 'high',
        expectedEffect: "Recover 15% of dormant customers' lifetime value with targeted offers."
      },
      resell: {
        channel: "sms",
        category: 'opportunity',
        confidence: 'high',
        expectedEffect: "Increase VIP customer repeat purchases by 20% through personalized SMS offers."
      },
      chase_leads: {
        channel: "task",
        category: 'action',
        confidence: 'medium',
        expectedEffect: "Convert 30% more new leads with dedicated rep follow-up."
      },
      reactivate: {
        channel: "email",
        category: 'watch',
        confidence: 'low',
        expectedEffect: "Recover 5% of lost customers with a final low-cost email campaign."
      },
      exclude_junk: {
        channel: "ad_audience",
        category: 'watch',
        confidence: 'medium',
        expectedEffect: "Reduce ad spend by 10% by excluding non-buyers from targeting."
      },
    });
  });

  it("returns nothing for an empty base", () => {
    expect(generatePlaybook({ stages: stages({}) })).toEqual([]);
  });

  it("honors the limit", () => {
    const actions = generatePlaybook({ stages: stages({ dormant: 5, vip: 5, new: 5, lost: 5, junk: 5 }), limit: 2 });
    expect(actions).toHaveLength(2);
    expect(actions.every(a => ['action', 'watch', 'opportunity'].includes(a.category))).toBe(true);
    expect(actions.every(a => ['high', 'medium', 'low'].includes(a.confidence))).toBe(true);
    expect(actions.every(a => typeof a.expectedEffect === 'string' && a.expectedEffect.length > 0)).toBe(true);
  });
});
