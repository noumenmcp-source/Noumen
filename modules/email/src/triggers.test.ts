import { describe, it, expect } from "vitest";
import { selectRecipients } from "./triggers.js";
import { makeProfile } from "./testutils.js";

describe("selectRecipients", () => {
  it("excludes profiles without an email", () => {
    const withEmail = makeProfile({ id: "a", email: "a@acme.test" });
    const noEmail = makeProfile({ id: "b", email: undefined });
    const out = selectRecipients([withEmail, noEmail], "welcome");
    expect(out.map((p) => p.id)).toEqual(["a"]);
  });

  it("welcome: only profiles not yet welcomed", () => {
    const fresh = makeProfile({ id: "fresh", traits: {} });
    const already = makeProfile({ id: "done", traits: { welcomed: true } });
    const out = selectRecipients([fresh, already], "welcome");
    expect(out.map((p) => p.id)).toEqual(["fresh"]);
  });

  it("abandoned_cart: cart with items and no completed order", () => {
    const abandoned = makeProfile({
      id: "cart",
      traits: { cartItemCount: 2, orderCompleted: false },
    });
    const purchased = makeProfile({
      id: "bought",
      traits: { cartItemCount: 2, orderCompleted: true },
    });
    const empty = makeProfile({ id: "empty", traits: { cartItemCount: 0 } });
    const out = selectRecipients(
      [abandoned, purchased, empty],
      "abandoned_cart",
    );
    expect(out.map((p) => p.id)).toEqual(["cart"]);
  });

  it("reactivation: dormant >= 30 days only", () => {
    const longAgo = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const recent = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const dormant = makeProfile({
      id: "dormant",
      intent: { lastActiveAt: longAgo },
    });
    const active = makeProfile({
      id: "active",
      intent: { lastActiveAt: recent },
    });
    const never = makeProfile({
      id: "never",
      intent: { lastActiveAt: undefined },
    });
    const out = selectRecipients([dormant, active, never], "reactivation");
    expect(out.map((p) => p.id)).toEqual(["dormant"]);
  });

  it("preserves input order", () => {
    const a = makeProfile({ id: "a", traits: {} });
    const b = makeProfile({ id: "b", traits: {} });
    const c = makeProfile({ id: "c", traits: {} });
    const out = selectRecipients([c, a, b], "welcome");
    expect(out.map((p) => p.id)).toEqual(["c", "a", "b"]);
  });
});
