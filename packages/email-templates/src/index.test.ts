import { describe, expect, it } from "vitest";

import { listTemplates, render, type TemplateName } from "./index.js";

const physicalAddress = "123 Market Street, Suite 400, San Francisco, CA 94105";
const unsubscribeUrl = "https://example.test/unsubscribe?user=fixture";

describe("@cdp-us/email-templates", () => {
  it("lists the available templates", () => {
    expect(listTemplates()).toEqual(["welcome", "abandoned_cart", "reactivation"]);
  });

  it.each([
    [
      "welcome",
      () =>
        render("welcome", {
          brandName: "Acme Data",
          firstName: "Ada",
          ctaUrl: "https://example.test/workspace",
          physicalAddress,
          unsubscribeUrl
        }),
      ["Acme Data", "Ada", "Open your workspace", "https://example.test/workspace"]
    ],
    [
      "abandoned_cart",
      () =>
        render("abandoned_cart", {
          brandName: "Acme Store",
          firstName: "Grace",
          cartUrl: "https://example.test/cart",
          itemName: "Analytics Starter Pack",
          physicalAddress,
          unsubscribeUrl
        }),
      ["Acme Store", "Grace", "Analytics Starter Pack", "https://example.test/cart"]
    ],
    [
      "reactivation",
      () =>
        render("reactivation", {
          brandName: "Acme Loyalty",
          firstName: "Katherine",
          ctaUrl: "https://example.test/reactivate",
          incentive: "WELCOME-BACK-20",
          physicalAddress,
          unsubscribeUrl
        }),
      ["Acme Loyalty", "Katherine", "WELCOME-BACK-20", "https://example.test/reactivate"]
    ]
  ] satisfies readonly [TemplateName, () => { html: string }, readonly string[]][])(
    "renders responsive HTML for %s with substituted variables and CAN-SPAM footer",
    (_templateName, renderTemplate, expectedValues) => {
      const { html } = renderTemplate();

      expect(html).toContain("<!doctype html>");
      expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
      expect(html).toContain("@media only screen and (min-width:480px)");
      expect(html).toContain(physicalAddress);
      expect(html).toContain(unsubscribeUrl.replace("&", "&amp;"));

      for (const expectedValue of expectedValues) {
        expect(html).toContain(expectedValue);
      }

      expect(html).not.toMatch(/\{\{[^}]+\}\}/u);
    }
  );
});
