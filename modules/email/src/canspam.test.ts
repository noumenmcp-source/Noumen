import { describe, it, expect } from "vitest";
import { enforceCanSpam } from "./canspam.js";

const ADDRESS = "CDP-US Inc, 123 Market St, San Francisco, CA 94105";
const UNSUB = "https://app.cdp-us.test/unsubscribe?t=abc";

describe("enforceCanSpam", () => {
  it("appends a footer with the physical address and unsubscribe link", () => {
    const out = enforceCanSpam("<p>Hi</p>", {
      physicalAddress: ADDRESS,
      unsubscribeUrl: UNSUB,
    });
    expect(out).toContain(ADDRESS);
    expect(out).toContain(UNSUB);
    expect(out.toLowerCase()).toContain("unsubscribe");
    expect(out).toContain("<p>Hi</p>");
  });

  it("injects the footer inside <body> when present", () => {
    const html = "<html><body><p>Hi</p></body></html>";
    const out = enforceCanSpam(html, {
      physicalAddress: ADDRESS,
      unsubscribeUrl: UNSUB,
    });
    expect(out.endsWith("</body></html>")).toBe(true);
    // footer must come before the closing body tag
    expect(out.indexOf("cdp-canspam-footer")).toBeLessThan(
      out.indexOf("</body>"),
    );
  });

  it("throws when the unsubscribe URL is missing", () => {
    expect(() =>
      enforceCanSpam("<p>Hi</p>", {
        physicalAddress: ADDRESS,
        unsubscribeUrl: "",
      }),
    ).toThrow(/unsubscribe/i);
  });

  it("throws when the physical address is missing", () => {
    expect(() =>
      enforceCanSpam("<p>Hi</p>", {
        physicalAddress: "   ",
        unsubscribeUrl: UNSUB,
      }),
    ).toThrow(/address/i);
  });
});
