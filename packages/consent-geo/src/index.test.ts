import type { ConsentState } from "@cdp-us/contracts";
import { describe, expect, it } from "vitest";
import { consentRequirements, isSaleAllowed, lawForState, STATE_LAWS } from "./index.js";

const consent: ConsentState = { analytics: true, marketing_email: true, sale_or_share: true, messaging_tcpa: true, gpc: false };

describe("consent geo", () => {
  it("resolves state privacy laws", () => {
    expect(lawForState("CA")).toMatchObject({ lawName: "CCPA/CPRA", requiresSaleOptOut: true, honorsGpc: true });
    expect(lawForState("NV")).toBeNull();
    expect(Object.keys(STATE_LAWS)).toEqual(expect.arrayContaining(["CA", "VA", "CO", "CT", "UT"]));
  });

  it("returns deterministic consent requirements", () => {
    expect(consentRequirements("UT")).toMatchObject({ saleOptOut: true, sensitiveOptIn: false, honorGpc: false });
    expect(consentRequirements("unknown")).toEqual({ saleOptOut: false, sensitiveOptIn: false, honorGpc: false });
  });

  it("blocks sale/share on honored GPC or explicit opt-out", () => {
    expect(isSaleAllowed("CA", consent, true)).toBe(false);
    expect(isSaleAllowed("VA", { ...consent, sale_or_share: false }, false)).toBe(false);
    expect(isSaleAllowed("NV", { ...consent, sale_or_share: false }, true)).toBe(true);
  });
});
