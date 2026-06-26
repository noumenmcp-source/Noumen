import { describe, it, expect } from "vitest";
import {
  resolveConsent,
  canSellOrShare,
  canEmail,
  canMessage,
  allowedPurposes,
} from "./cmp.js";

describe("resolveConsent", () => {
  it("applies US opt-out/opt-in defaults with no banner interaction", () => {
    const state = resolveConsent({});
    expect(state).toEqual({
      analytics: true, // opt-out: allowed by default
      marketing_email: false, // opt-in
      sale_or_share: true, // opt-out: allowed by default
      messaging_tcpa: false, // opt-in
      gpc: false,
    });
  });

  it("honors explicit opt-outs and opt-ins from the banner", () => {
    const state = resolveConsent({
      bannerChoice: {
        analyticsOptOut: true,
        saleOrShareOptOut: true,
        marketingEmailOptIn: true,
        messagingTcpaOptIn: true,
      },
    });
    expect(state).toEqual({
      analytics: false,
      marketing_email: true,
      sale_or_share: false,
      messaging_tcpa: true,
      gpc: false,
    });
  });

  it("GPC forces sale_or_share=false and records gpc=true", () => {
    const state = resolveConsent({
      // User did NOT opt out of sale/share in the banner...
      bannerChoice: { saleOrShareOptOut: false },
      gpc: true,
    });
    // ...but GPC overrides and forces it off.
    expect(state.sale_or_share).toBe(false);
    expect(state.gpc).toBe(true);
  });

  it("GPC does not affect opt-in marketing/messaging or analytics", () => {
    const state = resolveConsent({
      bannerChoice: { marketingEmailOptIn: true, messagingTcpaOptIn: true },
      gpc: true,
    });
    expect(state.analytics).toBe(true);
    expect(state.marketing_email).toBe(true);
    expect(state.messaging_tcpa).toBe(true);
    expect(state.sale_or_share).toBe(false);
    expect(state.gpc).toBe(true);
  });
});

describe("helpers", () => {
  it("canSellOrShare requires sale_or_share=true and no GPC", () => {
    expect(canSellOrShare(resolveConsent({}))).toBe(true);
    expect(canSellOrShare(resolveConsent({ gpc: true }))).toBe(false);
    expect(
      canSellOrShare(resolveConsent({ bannerChoice: { saleOrShareOptOut: true } })),
    ).toBe(false);
  });

  it("canEmail requires explicit marketing_email opt-in", () => {
    expect(canEmail(resolveConsent({}))).toBe(false);
    expect(
      canEmail(resolveConsent({ bannerChoice: { marketingEmailOptIn: true } })),
    ).toBe(true);
  });

  it("canMessage requires explicit TCPA opt-in", () => {
    expect(canMessage(resolveConsent({}))).toBe(false);
    expect(
      canMessage(resolveConsent({ bannerChoice: { messagingTcpaOptIn: true } })),
    ).toBe(true);
  });

  it("allowedPurposes reflects the resolved state", () => {
    const all = resolveConsent({
      bannerChoice: { marketingEmailOptIn: true, messagingTcpaOptIn: true },
    });
    expect(allowedPurposes(all).sort()).toEqual(
      ["analytics", "marketing_email", "messaging_tcpa", "sale_or_share"].sort(),
    );

    const gpc = resolveConsent({ gpc: true });
    expect(allowedPurposes(gpc)).toEqual(["analytics"]);
  });
});
