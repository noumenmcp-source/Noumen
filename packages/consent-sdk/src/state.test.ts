import { describe, expect, it } from "vitest";
import {
  acceptAllConsent,
  defaultConsent,
  isAllowed,
  rejectNonEssentialConsent,
  withGpc,
} from "./state.js";

describe("consent state", () => {
  it("accepts all purposes unless GPC locks sale/share", () => {
    expect(acceptAllConsent(false)).toMatchObject({
      analytics: true,
      marketing_email: true,
      sale_or_share: true,
      messaging_tcpa: true,
      gpc: false,
    });
    expect(acceptAllConsent(true).sale_or_share).toBe(false);
  });

  it("rejects non-essential while keeping analytics notice on", () => {
    expect(rejectNonEssentialConsent(false)).toMatchObject({
      analytics: true,
      marketing_email: false,
      sale_or_share: false,
      messaging_tcpa: false,
    });
  });

  it("forces sale/share off when GPC is present", () => {
    const state = withGpc({ ...defaultConsent(false), sale_or_share: true, gpc: true });
    expect(state.sale_or_share).toBe(false);
    expect(isAllowed(state, "sale_or_share")).toBe(false);
  });
});
