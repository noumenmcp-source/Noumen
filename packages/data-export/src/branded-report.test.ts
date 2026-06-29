import { describe, expect, it } from "vitest";
import { buildBrandedReport } from "./branded-report.js";

const DATA = {
  generatedAt: "2026-06-30T12:00:00.000Z",
  totalProfiles: 12259,
  stages: [
    { label: "vip", count: 312, pct: 2.5 },
    { label: "junk", count: 7484, pct: 61.1 },
  ],
  highlights: [{ label: "Revenue (12mo)", value: "$581,082" }],
};

describe("buildBrandedReport", () => {
  it("renders brand name, accent, stages, and highlights", () => {
    const html = buildBrandedReport({ name: "Acme Agency", accentColor: "#336699" }, DATA);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Acme Agency");
    expect(html).toContain("#336699"); // accepted accent
    expect(html).toContain("12,259"); // localized total
    expect(html).toContain("junk");
    expect(html).toContain("7,484");
    expect(html).toContain("$581,082");
    expect(html).toContain("@media print");
  });

  it("escapes operator-supplied brand fields (no HTML/JS injection)", () => {
    const html = buildBrandedReport({ name: '<script>alert(1)</script>' }, DATA);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("falls back to the default accent on an invalid color", () => {
    const html = buildBrandedReport({ name: "X", accentColor: "red; }body{display:none" }, DATA);
    expect(html).not.toContain("display:none");
    expect(html).toContain("#c9a84c"); // default AXIOM gold
  });

  it("only emits a logo <img> for an http(s) url", () => {
    const evil = buildBrandedReport({ name: "X", logoUrl: "javascript:alert(1)" }, DATA);
    expect(evil).not.toContain("javascript:alert(1)");
    const ok = buildBrandedReport({ name: "X", logoUrl: "https://cdn.example.com/l.png" }, DATA);
    expect(ok).toContain('<img class="logo" src="https://cdn.example.com/l.png"');
  });
});
