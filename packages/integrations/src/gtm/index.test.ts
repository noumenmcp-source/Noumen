import { describe, expect, it } from "vitest";
import { mapDataLayerEvent, renderDataLayerSnippet } from "./index.js";

describe("GTM integration", () => {
  it("renders a consent-gated dataLayer snippet", () => {
    const snippet = renderDataLayerSnippet({ writeKey: "wk_us", endpoint: "https://api.example.com/v1/track" });

    expect(snippet).toContain("wk_us");
    expect(snippet).toContain("https://api.example.com/v1/track");
    expect(snippet).toContain("var consent=false");
    expect(snippet).toContain("if(!consent)return false");
  });

  it("maps dataLayer track and identify entries", () => {
    expect(mapDataLayerEvent({ event: "Signup Completed", anonymousId: "anon_1", plan: "growth" })).toEqual({
      type: "track",
      anonymousId: "anon_1",
      event: "Signup Completed",
      properties: { plan: "growth" },
      ts: undefined,
    });
    expect(mapDataLayerEvent({ event: "identify", anonymousId: "anon_1", userId: "user_1", email: "buyer@example.com" }))
      .toMatchObject({ type: "identify", anonymousId: "anon_1", userId: "user_1" });
  });

  it("returns null for invalid dataLayer entries", () => {
    expect(mapDataLayerEvent(null)).toBeNull();
    expect(mapDataLayerEvent({ event: "Signup Completed" })).toBeNull();
  });
});
