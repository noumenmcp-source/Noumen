import { describe, expect, it } from "vitest";
import { InMemorySuppressionStore, buildDmarc, buildSpf, checkAuthRecords, classifyBounce, parseSpf, shouldSuppress, validateDkimSelector } from "./index.js";

describe("deliverability", () => {
  it("builds and parses auth records", () => {
    expect(buildSpf({ includes: ["sendgrid.net"], ip4: ["192.0.2.10"], all: "-all" })).toBe("v=spf1 include:sendgrid.net ip4:192.0.2.10 -all");
    expect(parseSpf("v=spf1 include:sendgrid.net -all")).toEqual({ valid: true, mechanisms: ["include:sendgrid.net", "-all"], all: "-all" });
    expect(buildDmarc({ policy: "reject", rua: "mailto:dmarc@example.com", pct: 100 })).toBe("v=DMARC1; p=reject; rua=mailto:dmarc@example.com; pct=100");
  });

  it("reports weak or missing auth records", () => {
    expect(validateDkimSelector("marketing-2026")).toBe(true);
    expect(validateDkimSelector("bad selector")).toBe(false);
    expect(checkAuthRecords({ spf: "v=spf1 ~all", dmarc: "v=DMARC1; p=none", dkim: [] }).warnings).toEqual(["weak_spf_all", "monitor_only_dmarc", "missing_dkim"]);
    expect(checkAuthRecords({ spf: "v=spf1 -all", dmarc: "v=DMARC1; p=reject", dkim: ["s1"] })).toMatchObject({ spfAligned: true, dmarcAligned: true, dkimAligned: true });
  });

  it("classifies common delivery events", () => {
    expect(classifyBounce({ type: "bounce", code: "550" })).toBe("hard");
    expect(classifyBounce({ type: "bounce", code: "421" })).toBe("soft");
    expect(classifyBounce({ type: "complaint", reason: "abuse" })).toBe("complaint");
    expect(classifyBounce({ type: "delivered" })).toBe("unknown");
  });

  it("suppresses normalized email addresses", async () => {
    const store = new InMemorySuppressionStore([{ email: "Buyer@Example.com", reason: "hard-bounce" }]);
    await store.add({ email: "optout@example.com", reason: "unsubscribe" });

    expect(await shouldSuppress(" buyer@example.com ", store)).toBe(true);
    expect(await shouldSuppress("optout@example.com", store)).toBe(true);
    expect(await shouldSuppress("new@example.com", store)).toBe(false);
  });
});
