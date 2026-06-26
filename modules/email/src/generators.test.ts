import { describe, it, expect } from "vitest";
import { TemplateGenerator, renderTemplate } from "./generators.js";
import type { GenerationContext } from "./types.js";
import { makeProfile } from "./testutils.js";

const ctx: GenerationContext = {
  trigger: "welcome",
  brandName: "CDP-US",
  ctaUrl: "https://app.cdp-us.test/start",
};

describe("TemplateGenerator (deterministic)", () => {
  it("produces identical output for identical inputs", async () => {
    const gen = new TemplateGenerator();
    const p = makeProfile();
    const a = await gen.generate(p, ctx);
    const b = await gen.generate(p, ctx);
    expect(a).toEqual(b);
  });

  it("personalizes the subject from firmographics + brand", async () => {
    const gen = new TemplateGenerator();
    const out = await gen.generate(makeProfile(), ctx);
    expect(out.subject).toBe("Welcome to CDP-US, Acme Corp");
  });

  it("includes company, industry and high-intent copy in the html", async () => {
    const out = renderTemplate(makeProfile(), ctx);
    expect(out.html).toContain("Acme Corp");
    expect(out.html).toContain("Manufacturing");
    // intent score 80 >= 70 -> strong-interest line referencing top topic
    expect(out.html).toContain("strong, recent interest");
    expect(out.html).toContain("pricing");
    expect(out.html).toContain("https://app.cdp-us.test/start");
  });

  it("falls back to safe defaults when firmographics are empty", async () => {
    const out = renderTemplate(
      makeProfile({
        firmographics: { company: "", industry: "" },
        intent: { score: 0, topics: [], lastActiveAt: undefined },
      }),
      ctx,
    );
    expect(out.subject).toBe("Welcome to CDP-US, your team");
    expect(out.html).toContain("your team");
    // no industry line when industry is missing
    expect(out.html).not.toContain("Teams in");
  });

  it("renders distinct subjects per trigger", () => {
    const p = makeProfile();
    const welcome = renderTemplate(p, { ...ctx, trigger: "welcome" });
    const cart = renderTemplate(p, {
      ...ctx,
      trigger: "abandoned_cart",
      productName: "Pro Plan",
    });
    const react = renderTemplate(p, { ...ctx, trigger: "reactivation" });
    expect(welcome.subject).toContain("Welcome");
    expect(cart.subject).toContain("Pro Plan");
    expect(react.subject).toContain("miss you");
  });

  it("escapes HTML in profile-derived values", () => {
    const out = renderTemplate(
      makeProfile({ firmographics: { company: "<script>x</script>" } }),
      ctx,
    );
    expect(out.html).not.toContain("<script>x</script>");
    expect(out.html).toContain("&lt;script&gt;");
  });
});
