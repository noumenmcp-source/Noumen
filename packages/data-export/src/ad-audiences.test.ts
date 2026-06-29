import { describe, expect, it } from "vitest";
import { buildAdAudienceCsv, hashEmail, hashPhone, normalizePhone } from "./ad-audiences.js";

// Locked spec vectors (SHA-256 lower hex of the normalized identifier).
const EMAIL_HASH = "973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b"; // test@example.com
const PHONE_HASH = "50389806e2857c36e22b0a1ed1e7df8606ebc0e931f6c083e73486f7a87d9a9f"; // +14155551234

describe("ad-audience hashing", () => {
  it("normalizes email (trim+lowercase) before hashing", () => {
    expect(hashEmail("  Test@Example.com ")).toBe(EMAIL_HASH);
    expect(hashEmail("test@example.com")).toBe(EMAIL_HASH);
  });

  it("normalizes phone to E.164-ish before hashing", () => {
    expect(normalizePhone("+1 (415) 555-1234")).toBe("+14155551234");
    expect(hashPhone("+1 (415) 555-1234")).toBe(PHONE_HASH);
    expect(hashEmail("")).toBe("");
    expect(hashPhone("")).toBe("");
  });
});

describe("buildAdAudienceCsv", () => {
  it("Meta: email-only header + hashed rows, skips blanks, de-dupes", () => {
    const csv = buildAdAudienceCsv(
      [{ email: "test@example.com" }, { email: "TEST@example.com" }, { email: "" }, {}],
      "meta",
    );
    expect(csv).toBe(`email\n${EMAIL_HASH}`);
  });

  it("Google: capitalized headers and includePhone column", () => {
    const csv = buildAdAudienceCsv(
      [{ email: "test@example.com", phone: "+1 (415) 555-1234" }],
      "google",
      { includePhone: true },
    );
    expect(csv).toBe(`Email,Phone\n${EMAIL_HASH},${PHONE_HASH}`);
  });

  it("keeps a phone-only row when phone column is enabled", () => {
    const csv = buildAdAudienceCsv([{ phone: "+14155551234" }], "meta", { includePhone: true });
    expect(csv).toBe(`email,phone\n,${PHONE_HASH}`);
  });
});
