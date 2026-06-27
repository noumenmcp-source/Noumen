import { afterEach, describe, expect, it, vi } from "vitest";
import { createConsentManager } from "./manager.js";

describe("createConsentManager", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("persists choices and round-trips saved state", () => {
    const manager = createConsentManager({ persistKey: "test_consent" });
    manager.acceptAll();

    const restored = createConsentManager({ persistKey: "test_consent" });
    expect(restored.getConsent().marketing_email).toBe(true);
    expect(restored.isAllowed("analytics")).toBe(true);
  });

  it("syncs endpoint changes gracefully", () => {
    const fetch = vi.fn(() => Promise.reject(new Error("offline")));
    vi.stubGlobal("fetch", fetch);
    const listener = vi.fn();

    const manager = createConsentManager({ endpoint: "/consent", onChange: listener });
    expect(() => manager.rejectNonEssential()).not.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "/consent",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("opens preferences after a stored choice exists", () => {
    const manager = createConsentManager({ persistKey: "stored_widget" });
    manager.acceptAll();
    const restored = createConsentManager({ persistKey: "stored_widget" });

    restored.openPreferences();

    expect(document.querySelector("form")?.hidden).toBe(false);
  });
});
